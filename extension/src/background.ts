import * as flatbuffers from "flatbuffers";
import { Message } from "./discuss/flatbuffers/message";
import { MessageBody } from "./discuss/flatbuffers/message-body";
import { Ping } from "./discuss/flatbuffers/ping";

const WS_URL = "ws://127.0.0.1:49152";
const ACTIVE_APP_ICON = "/assets/icons/active_icon.png";
const INACTIVE_APP_ICON = "/assets/icons/inactive_icon.png";

let socket: WebSocket | null = null;
const RECONNECT_ALARM_NAME = "reconnect_alarm";

interface IsTalkingMap {
    [tabId: number]: boolean;
}

interface ExtensionMessage {
    type: string;
    value?: unknown;
}

// Helper to handle Chrome storage safely
async function getIsTalkingByTabId(): Promise<IsTalkingMap> {
    const { isTalkingByTabId = {} } = await chrome.storage.session.get();
    return isTalkingByTabId as IsTalkingMap;
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
    const isTalkingByTabId = await getIsTalkingByTabId();
    delete isTalkingByTabId[tabId];
    await chrome.storage.session.set({ isTalkingByTabId });
    await updateAppIcon();
});

chrome.action.onClicked.addListener(function () {
    const isFirefox = /Firefox/i.test(navigator.userAgent);
    if (isFirefox) {
        // Firefox doesn't simplify linking to extension shortcuts yet
        return;
    }
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

async function updateAppIcon() {
    const isTalkingByTabId = await getIsTalkingByTabId();
    const isTalking = Object.values(isTalkingByTabId).some(Boolean);
    chrome.action.setIcon({ path: isTalking ? ACTIVE_APP_ICON : INACTIVE_APP_ICON });
}

async function handleMessage(
    request: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
) {
    const { type, value } = request;
    const tabId = sender.tab ? sender.tab.id : null;

    if (!tabId && type !== "ask-version") {
        console.warn(`Received ${type} message without a valid Tab ID.`);
        sendResponse?.({ error: "no-tab" });
        return;
    }

    console.log(`Received message: ${type}, tab: ${tabId}`);

    // Non-null assertion for tabId where required, checked above.
    const safeTabId = tabId as number;

    switch (type) {
        case "subscribe":
            {
                const isTalkingByTabId = await getIsTalkingByTabId();
                isTalkingByTabId[safeTabId] = false;
                await chrome.storage.session.set({ isTalkingByTabId });
                console.log(`Tab ${safeTabId} subscribed to PTT events.`);
                sendResponse?.({ status: "ok" });
            }
            break;
        case "unsubscribe":
            {
                const isTalkingByTabId = await getIsTalkingByTabId();
                delete isTalkingByTabId[safeTabId];
                await chrome.storage.session.set({ isTalkingByTabId });
                await updateAppIcon();
                sendResponse?.({ status: "ok" });
            }
            break;
        case "is-talking":
            {
                const isTalkingByTabId = await getIsTalkingByTabId();
                isTalkingByTabId[safeTabId] = value as boolean;
                await chrome.storage.session.set({ isTalkingByTabId });
                await updateAppIcon();
                sendResponse?.({ status: "ok" });
            }
            break;
        case "ask-is-enabled":
            chrome.tabs.sendMessage(safeTabId, {
                from: "discuss-push-to-talk",
                type: "answer-is-enabled"
            });
            sendResponse?.({ status: "ok" });
            break;
        case "ask-version":
            sendResponse(chrome.runtime.getManifest().version);
            break;
        default:
            sendResponse?.({ error: "unknown-type" });
    }
}

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    handleMessage(request, sender, sendResponse);
    return true; // Keep channel open for async sendResponse
});
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request, sender, sendResponse);
    return true; // Keep channel open for async sendResponse
});

async function onCommand(command: "toggle-voice" | "ptt-pressed" | "ptt-released") {
    const isTalkingByTabId = await getIsTalkingByTabId();
    const tabIds = Object.keys(isTalkingByTabId);
    console.log(`onCommand: ${command}, targets: ${tabIds.length} tabs`, tabIds);

    for (const tabIdStr of tabIds) {
        const tabId = Number(tabIdStr);
        switch (command) {
            case "toggle-voice":
                chrome.tabs.sendMessage(tabId, {
                    from: "discuss-push-to-talk",
                    type: "toggle-voice"
                });
                break;
            case "ptt-pressed":
                console.log(`Sending ptt-pressed to tab ${tabId}`);
                chrome.tabs.sendMessage(tabId, {
                    from: "discuss-push-to-talk",
                    type: "push-to-talk-pressed"
                });
                break;
            case "ptt-released":
                console.log(`Sending ptt-released to tab ${tabId}`);
                chrome.tabs.sendMessage(tabId, {
                    from: "discuss-push-to-talk",
                    type: "push-to-talk-released"
                });
                break;
        }
    }
}

function connectToApp() {
    if (
        socket &&
        (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
        return;
    }

    console.log("Attempting to connect to WS:", WS_URL);
    try {
        socket = new WebSocket(WS_URL);
        socket.binaryType = "arraybuffer";
    } catch {
        return;
    }

    let pingInterval: ReturnType<typeof setInterval>;

    socket.onopen = () => {
        console.log("Connected to Discuss Companion via WebSocket");
        chrome.alarms.clear(RECONNECT_ALARM_NAME);

        // Send initial Ping
        sendPing();

        pingInterval = setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) {
                sendPing();
            }
        }, 30000);
    };

    socket.onmessage = (event) => {
        try {
            const data = new Uint8Array(event.data);
            const buf = new flatbuffers.ByteBuffer(data);
            const message = Message.getRootAsMessage(buf);

            if (message.bodyType() === MessageBody.PttDown) {
                onCommand("ptt-pressed");
            } else if (message.bodyType() === MessageBody.PttUp) {
                onCommand("ptt-released");
            } else if (message.bodyType() === MessageBody.Pong) {
                // console.log("Received Pong");
            }
        } catch (e) {
            console.error("Failed to parse message:", e);
        }
    };

    socket.onclose = (e) => {
        console.log("WS Disconnected. code:", e.code, "reason:", e.reason);
        if (pingInterval) {
            clearInterval(pingInterval);
        }
        socket = null;
        chrome.alarms.create(RECONNECT_ALARM_NAME, { delayInMinutes: 0.1 });
    };

    socket.onerror = (error) => {
        console.error("WebSocket connection error");
    };
}

function sendPing() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
    }

    const builder = new flatbuffers.Builder(64);
    Ping.startPing(builder);
    const pingOffset = Ping.endPing(builder);

    Message.startMessage(builder);
    Message.addBodyType(builder, MessageBody.Ping);
    Message.addBody(builder, pingOffset);
    const messageOffset = Message.endMessage(builder);
    builder.finish(messageOffset);

    socket.send(builder.asUint8Array());
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECONNECT_ALARM_NAME) {
        console.log("Reconnection alarm fired");
        connectToApp();
    }
});

connectToApp();
