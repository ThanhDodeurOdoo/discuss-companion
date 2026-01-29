import * as flatbuffers from "flatbuffers";
import { Message } from "./discuss/ws-protocol/message";
import { MessageBody } from "./discuss/ws-protocol/message-body";
import { Ping } from "./discuss/ws-protocol/ping";
import { throttle } from "./utils";

const ACTIVE_ONLINE_ICON = "/assets/icons/active_online_icon.png";
const INACTIVE_ONLINE_ICON = "/assets/icons/inactive_online_icon.png";
const INACTIVE_OFFLINE_ICON = "/assets/icons/inactive_offline_icon.png";

let socket: WebSocket | null = null;
let wsPort = 49152; // Default port
const RECONNECT_ALARM_NAME = "reconnect_alarm";
let isCompanionEnabled = false;

interface IsTalkingMap {
    [tabId: number]: boolean;
}

interface ExtensionMessage {
    type: string;
    value?: unknown;
}

enum Command {
    PTT_PRESSED = "ptt-pressed",
    PTT_RELEASED = "ptt-released",
    TOGGLE_VOICE = "toggle-voice"
}

const mutedLog = (...args: unknown[]) => {};
let log = mutedLog;

chrome.storage.local.get(
    { wsPort: 49152, isLoggingEnabled: false, isCompanionEnabled: false },
    (items) => {
        wsPort = items.wsPort as number;
        if (items.isLoggingEnabled) {
            log = console.log;
        }
        isCompanionEnabled = Boolean(items.isCompanionEnabled);
        if (isCompanionEnabled) {
            connectToApp();
        } else {
            updateAppIcon();
        }
    }
);

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local") {
        if (changes.wsPort) {
            const newPort = changes.wsPort.newValue as number;
            wsPort = newPort;
            if (socket) {
                socket.close(); // Close will trigger reconnect logic via onclose/alarm or we can force it
            } else {
                connectToApp();
            }
        }
        if (changes.isLoggingEnabled) {
            if (changes.isLoggingEnabled.newValue) {
                log = console.log;
            } else {
                log = mutedLog;
            }
        }
        if (changes.isCompanionEnabled) {
            isCompanionEnabled = Boolean(changes.isCompanionEnabled.newValue);
            if (!isCompanionEnabled) {
                chrome.alarms.clear(RECONNECT_ALARM_NAME);
                if (socket) {
                    socket.close();
                } else {
                    updateAppIcon();
                }
            } else {
                connectToApp();
            }
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
        chrome.tabs.create({ url: "about:addons" });
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

/**
 * FIXME: The function is delayed because the subscription occurs at the start of rtc.joinCall(),
 * which means the RPC is made and before `rtc.selfSession` and `rtc.channel` are set.
 * This is technically incorrect as the tab will be subscribed even if the join fails,
 * it should ideally be subscribed at the end of the joinCall function, if it is successful,
 * and after selfSession and channel are set.
 */
function delayedSubscribe(safeTabId: number) {
    setTimeout(() => {
        chrome.scripting
            .executeScript({
                target: { tabId: safeTabId },
                world: "MAIN",
                func: () => {
                    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
                    const channel = store?.rtc?.channel as { id: number; name: string } | undefined;
                    return {
                        channelId: channel?.id,
                        channelName: channel?.name,
                        origin: window.location.origin
                    };
                }
            })
            .then((results) => {
                const result = results[0]?.result as
                    | { channelId?: number; channelName?: string; origin?: string }
                    | undefined;
                if (result?.channelId && result?.origin) {
                    const { channelId, channelName, origin } = result;
                    const url = new URL("/odoo/action-mail.action_discuss", origin);
                    url.searchParams.set("active_id", `discuss.channel_${channelId}`);
                    url.searchParams.set("call", "accept");
                    const lastJoinedCall = {
                        url: url.toString(),
                        name: channelName || "last call"
                    };
                    chrome.storage.local.set({ lastJoinedCall });
                    log("[BG] Captured call info", lastJoinedCall);
                }
                log("[BG] Captured call info", result);
            })
            .catch((e) => {
                log("Failed to capture call info", e);
            });
    }, 3000);
}

const throttledCommand = throttle(onCommand, 150);

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
                delayedSubscribe(safeTabId);
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
    log("[BG] onMessageExternal", request, sender);
    handleMessage(request, sender, sendResponse);
    return true; // Keep channel open for async sendResponse
});
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log("[BG] onMessage", request, sender);
    handleMessage(request, sender, sendResponse);
    return true; // Keep channel open for async sendResponse
});

async function onCommand(command: Command) {
    log("[BG] onCommand", command);
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
    if (!isCompanionEnabled) {
        return;
    }
    if (
        socket &&
        (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
        return;
    }

    const wsUrl = `ws://127.0.0.1:${wsPort}`;
    try {
        log("[BG] Connecting to WS", wsUrl);
        socket = new WebSocket(wsUrl);
        socket.binaryType = "arraybuffer";
    } catch (e) {
        log("[BG] WebSocket creation failed", e);
        return;
    }

    let pingInterval: ReturnType<typeof setInterval>;

    socket.onopen = () => {
        log("[BG] WS Open");
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

            log("[BG] WS Message bodyType:", message.bodyType());
            switch (message.bodyType()) {
                case MessageBody.PttDown:
                    throttledCommand(Command.PTT_PRESSED);
                    break;
                case MessageBody.PttUp:
                    onCommand(Command.PTT_RELEASED);
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
        log("[BG] WS Close", e);
        if (pingInterval) {
            clearInterval(pingInterval);
        }
        socket = null;
        updateAppIcon();
        if (isCompanionEnabled) {
            chrome.alarms.create(RECONNECT_ALARM_NAME, { delayInMinutes: 0.1 });
        } else {
            chrome.alarms.clear(RECONNECT_ALARM_NAME);
        }
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

chrome.commands.onCommand.addListener((command) => {
    throttledCommand(command as Command);
});
