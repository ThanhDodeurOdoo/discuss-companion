import { createMessageHandlers, type MessageHandlers } from "./service_worker_messages";

const mutedLog = (..._args: unknown[]) => {};
let logTarget: (...args: unknown[]) => void = mutedLog;
const log = (...args: unknown[]) => logTarget(...args);

const messageHandlers: MessageHandlers = createMessageHandlers({
    log
});

chrome.storage.local.get({ isLoggingEnabled: false }, (items) => {
    logTarget = items.isLoggingEnabled ? console.log : mutedLog;
});

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

chrome.commands.onCommand.addListener((command) => {
    messageHandlers.handleCommand(command);
});

void messageHandlers.updateAppIcon();

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
        return;
    }
    if (changes.isLoggingEnabled) {
        logTarget = changes.isLoggingEnabled.newValue ? console.log : mutedLog;
    }
});
