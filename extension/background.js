const WS_URL = "ws://127.0.0.1:49152";
const ACTIVE_APP_ICON = "/assets/icons/active_icon.png";
const INACTIVE_APP_ICON = "/assets/icons/inactive_icon.png";

let socket = null;

async function getIsTalkingByTabId() {
    const { isTalkingByTabId = {} } = await chrome.storage.session.get();
    return isTalkingByTabId;
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
    const isTalkingByTabId = await getIsTalkingByTabId();
    delete isTalkingByTabId[tabId];
    await chrome.storage.session.set({ isTalkingByTabId });
    await updateAppIcon();
});

chrome.action.onClicked.addListener(function () {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

async function updateAppIcon() {
    const isTalkingByTabId = await getIsTalkingByTabId();
    const isTalking = Object.values(isTalkingByTabId).some(Boolean);
    chrome.action.setIcon({ path: isTalking ? ACTIVE_APP_ICON : INACTIVE_APP_ICON });
}

async function handleMessage(request, sender, sendResponse) {
    const { type, value } = request;
    const tabId = sender.tab ? sender.tab.id : null;

    if (!tabId && type !== "ask-version") {
        console.warn(`Received ${type} message without a valid Tab ID.`);
        sendResponse?.({ error: "no-tab" });
        return;
    }

    console.log(`Received message: ${type}, tab: ${tabId}`);

    switch (type) {
        case "subscribe":
            {
                const isTalkingByTabId = await getIsTalkingByTabId();
                isTalkingByTabId[tabId] = false;
                await chrome.storage.session.set({ isTalkingByTabId });
                console.log(`Tab ${tabId} subscribed to PTT events.`);
                sendResponse?.({ status: "ok" });
            }
            break;
        case "unsubscribe":
            {
                const isTalkingByTabId = await getIsTalkingByTabId();
                delete isTalkingByTabId[tabId];
                await chrome.storage.session.set({ isTalkingByTabId });
                await updateAppIcon();
                sendResponse?.({ status: "ok" });
            }
            break;
        case "is-talking":
            {
                const isTalkingByTabId = await getIsTalkingByTabId();
                isTalkingByTabId[tabId] = value;
                await chrome.storage.session.set({ isTalkingByTabId });
                await updateAppIcon();
                sendResponse?.({ status: "ok" });
            }
            break;
        case "ask-is-enabled":
            chrome.tabs.sendMessage(tabId, {
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

/**
 * Broadcast commands to all subcribers. Note that anyone can subscribe to the
 * extension thus no sensitive data should be sent.
 *
 * @param {"toggle-voice"|"ptt-pressed"|"ptt-released"} command
 */
async function onCommand(command) {
    const isTalkingByTabId = await getIsTalkingByTabId();
    const tabIds = Object.keys(isTalkingByTabId);
    console.log(`onCommand: ${command}, targets: ${tabIds.length} tabs`, tabIds);

    for (const tabId of tabIds) {
        switch (command) {
            case "toggle-voice":
                chrome.tabs.sendMessage(Number(tabId), {
                    from: "discuss-push-to-talk",
                    type: "toggle-voice"
                });
                break;
            case "ptt-pressed":
                console.log(`Sending ptt-pressed to tab ${tabId}`);
                chrome.tabs.sendMessage(Number(tabId), {
                    from: "discuss-push-to-talk",
                    type: "push-to-talk-pressed"
                });
                break;
            case "ptt-released":
                console.log(`Sending ptt-released to tab ${tabId}`);
                chrome.tabs.sendMessage(Number(tabId), {
                    from: "discuss-push-to-talk",
                    type: "push-to-talk-released"
                });
                break;
        }
    }
}

const RECONNECT_ALARM_NAME = "reconnect_alarm";

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
    } catch {
        // Silently fail, the alarm system will retry
        return;
    }

    socket.onopen = () => {
        console.log("Connected to Discuss Companion via WebSocket");
        // Clear any pending reconnection alarms
        chrome.alarms.clear(RECONNECT_ALARM_NAME);
        socket.send(JSON.stringify({ type: "ping" }));

        // Keep-alive loop (still useful while connected/active)
        socket._pingInterval = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "ping" }));
            }
        }, 30000);
    };

    socket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            console.log("WS Received:", message.type);
            if (message.type === "ptt_down") {
                onCommand("ptt-pressed");
            } else if (message.type === "ptt_up") {
                onCommand("ptt-released");
            } else if (message.type === "pong") {
                console.log("Received Pong from App:", message);
            }
        } catch (e) {
            console.error("Failed to parse message:", e);
        }
    };

    socket.onclose = (e) => {
        console.log("WS Disconnected. code:", e.code, "reason:", e.reason);
        if (socket._pingInterval) {
            clearInterval(socket._pingInterval);
        }
        socket = null;
        // Schedule reconnection attempt via alarm
        chrome.alarms.create(RECONNECT_ALARM_NAME, { delayInMinutes: 0.1 });
    };

    socket.onerror = (error) => {
        console.error("WebSocket connection error");
    };
}

// Listen for the alarm to trigger reconnection
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECONNECT_ALARM_NAME) {
        console.log("Reconnection alarm fired");
        connectToApp();
    }
});

connectToApp();
