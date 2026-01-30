import { createConnectionManager } from "./service_worker_connection";
import { createMessageHandlers, type MessageHandlers } from "./service_worker_messages";

const mutedLog = (..._args: unknown[]) => {};
let logTarget: (...args: unknown[]) => void = mutedLog;
const log = (...args: unknown[]) => logTarget(...args);

let messageHandlers: MessageHandlers;

const connection = createConnectionManager({
    log,
    onPttPressed: () => messageHandlers.handleCommand("ptt-pressed"),
    onPttReleased: () => messageHandlers.handleCommandImmediate("ptt-released"),
    onStatusState: (state) => {
        void messageHandlers.handleStatusState(state);
    },
    onConnectionStateChange: () => {
        void messageHandlers.updateAppIcon();
    },
    onLoggingChange: (isEnabled) => {
        logTarget = isEnabled ? console.log : mutedLog;
    }
});

messageHandlers = createMessageHandlers({
    log,
    isConnected: connection.isConnected
});

connection.init();

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    log("[BG] onMessageExternal", request, sender);
    void messageHandlers.handleMessage(request, sender, sendResponse);
    return true;
});
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log("[BG] onMessage", request, sender);
    void messageHandlers.handleMessage(request, sender, sendResponse);
    return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
    await messageHandlers.handleTabRemoved(tabId);
});

chrome.action.onClicked.addListener(() => {
    messageHandlers.handleActionClicked();
});

chrome.alarms.onAlarm.addListener(connection.handleAlarm);

chrome.commands.onCommand.addListener((command) => {
    messageHandlers.handleCommand(command);
});
