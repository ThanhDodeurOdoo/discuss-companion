import * as flatbuffers from "flatbuffers";
import { Message } from "./discuss/flatbuffers/message";
import { MessageBody } from "./discuss/flatbuffers/message-body";
import { Ping } from "./discuss/flatbuffers/ping";

const ACTIVE_ONLINE_ICON = "/assets/icons/active_online_icon.png";
const INACTIVE_ONLINE_ICON = "/assets/icons/inactive_online_icon.png";
const INACTIVE_OFFLINE_ICON = "/assets/icons/inactive_offline_icon.png";

let socket: WebSocket | null = null;
let wsPort = 49152; // Default port
const RECONNECT_ALARM_NAME = "reconnect_alarm";

interface IsTalkingMap {
    [tabId: number]: boolean;
}

interface ExtensionMessage {
    type: string;
    value?: unknown;
}

chrome.storage.local.get({ wsPort: 49152 }, (items) => {
    wsPort = items.wsPort as number;
    connectToApp();
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && changes.wsPort) {
        const newPort = changes.wsPort.newValue as number;
        wsPort = newPort;
        if (socket) {
            socket.close(); // Close will trigger reconnect logic via onclose/alarm or we can force it
        } else {
            connectToApp();
        }
    }
});

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
    const isConnected = socket?.readyState === WebSocket.OPEN;
    if (!isConnected) {
        chrome.action.setIcon({ path: INACTIVE_OFFLINE_ICON });
        return;
    }

    const isTalkingByTabId = await getIsTalkingByTabId();
    const isTalking = Object.values(isTalkingByTabId).some(Boolean);
    chrome.action.setIcon({ path: isTalking ? ACTIVE_ONLINE_ICON : INACTIVE_ONLINE_ICON });
}

async function handleMessage(
    request: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
) {
    const { type, value } = request;
    const tabId = sender.tab ? sender.tab.id : null;

    if (!tabId && type !== "ask-version") {
        sendResponse?.({ error: "no-tab" });
        return;
    }

    const safeTabId = tabId as number;

    switch (type) {
        case "subscribe":
            {
                const isTalkingByTabId = await getIsTalkingByTabId();
                isTalkingByTabId[safeTabId] = false;
                await chrome.storage.session.set({ isTalkingByTabId });
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
    console.log("[BG] onMessageExternal", request, sender);
    handleMessage(request, sender, sendResponse);
    return true; // Keep channel open for async sendResponse
});
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("[BG] onMessage", request, sender);
    handleMessage(request, sender, sendResponse);
    return true; // Keep channel open for async sendResponse
});

async function onCommand(command: "toggle-voice" | "ptt-pressed" | "ptt-released") {
    console.log("[BG] onCommand", command);
    const isTalkingByTabId = await getIsTalkingByTabId();
    const tabIds = Object.keys(isTalkingByTabId);

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
                chrome.tabs.sendMessage(tabId, {
                    from: "discuss-push-to-talk",
                    type: "push-to-talk-pressed"
                });
                break;
            case "ptt-released":
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

    const wsUrl = `ws://127.0.0.1:${wsPort}`;
    try {
        console.log("[BG] Connecting to WS", wsUrl);
        socket = new WebSocket(wsUrl);
        socket.binaryType = "arraybuffer";
    } catch (e) {
        console.error("[BG] WebSocket creation failed", e);
        return;
    }

    let pingInterval: ReturnType<typeof setInterval>;

    socket.onopen = () => {
        console.log("[BG] WS Open");
        chrome.alarms.clear(RECONNECT_ALARM_NAME);
        updateAppIcon();

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

            console.log("[BG] WS Message bodyType:", message.bodyType());
            switch (message.bodyType()) {
                case MessageBody.PttDown:
                    onCommand("ptt-pressed");
                    break;
                case MessageBody.PttUp:
                    onCommand("ptt-released");
                    break;
                case MessageBody.Pong:
                    break;
                default:
                    break;
            }
        } catch {
            // skip
        }
    };

    socket.onclose = (e) => {
        console.log("[BG] WS Close", e);
        if (pingInterval) {
            clearInterval(pingInterval);
        }
        socket = null;
        updateAppIcon();
        chrome.alarms.create(RECONNECT_ALARM_NAME, { delayInMinutes: 0.1 });
    };

    socket.onerror = (error) => {
        console.error("[BG] WS Error", error);
        updateAppIcon();
    };
}

function sendPing() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        updateAppIcon();
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
        connectToApp();
    }
});
