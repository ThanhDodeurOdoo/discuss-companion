import { createMessageHandlers, type MessageHandlers } from "./service_worker_messages";
import { IS_FIREFOX_BUILD } from "./env";
import { clearSessionState } from "./storage/session_state";

const mutedLog = (..._args: unknown[]) => {};
let logTarget: (...args: unknown[]) => void = mutedLog;
const log = (...args: unknown[]) => logTarget(...args);

const messageHandlers: MessageHandlers = createMessageHandlers({
    log
});

if (IS_FIREFOX_BUILD) {
    chrome.runtime.onStartup.addListener(() => {
        void clearSessionState();
    });
    chrome.runtime.onInstalled.addListener(() => {
        void clearSessionState();
    });
}

chrome.storage.local.get({ isLoggingEnabled: false }, (items) => {
    logTarget = items.isLoggingEnabled ? console.log : mutedLog;
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

if (!IS_FIREFOX_BUILD) {
    chrome.commands.onCommand.addListener((command) => {
        messageHandlers.handleCommand(command);
    });
}

void messageHandlers.updateAppIcon();

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
        return;
    }
    if (changes.isLoggingEnabled) {
        logTarget = changes.isLoggingEnabled.newValue ? console.log : mutedLog;
    }
});
