import {
    isCallAction,
    requiresFocusCallTab,
    type CallAction,
    type CallActionOptions
} from "../call_actions";

type PttCommand = "ptt-down" | "ptt-up" | "toggle-voice";

export function createContentForwarders(deps: { focusCallTab: () => Promise<boolean> }) {
    const { focusCallTab } = deps;

    function isPttCommand(command: unknown): command is PttCommand {
        return command === "ptt-down" || command === "ptt-up" || command === "toggle-voice";
    }

    async function forwardCallAction(
        tabId: number,
        payload: { action?: CallAction; options?: CallActionOptions } | null,
        sendResponse: (response?: unknown) => void
    ): Promise<void> {
        const action = payload?.action;
        if (!action || !isCallAction(action)) {
            sendResponse?.({ error: "invalid-action" });
            return;
        }
        if (payload?.options?.focusCallTab || requiresFocusCallTab(action)) {
            await focusCallTab();
        }
        chrome.tabs.sendMessage(
            tabId,
            { type: "content-call-action", value: payload },
            (response) => {
                if (chrome.runtime.lastError) {
                    sendResponse?.({ error: "message-failed" });
                    return;
                }
                sendResponse?.(response);
            }
        );
    }

    async function forwardRefreshCallState(
        tabId: number,
        sendResponse: (response?: unknown) => void
    ): Promise<void> {
        chrome.tabs.sendMessage(tabId, { type: "content-refresh-call-state" }, (response) => {
            if (chrome.runtime.lastError) {
                sendResponse?.({ error: "message-failed" });
                return;
            }
            sendResponse?.(response);
        });
    }

    async function forwardPttCommand(
        tabId: number,
        payload: { command?: PttCommand } | null,
        sendResponse: (response?: unknown) => void
    ): Promise<void> {
        const command = payload?.command;
        if (!isPttCommand(command)) {
            sendResponse?.({ error: "invalid-command" });
            return;
        }
        chrome.tabs.sendMessage(
            tabId,
            { type: "content-ptt-command", value: { command } },
            (response) => {
                if (chrome.runtime.lastError) {
                    sendResponse?.({ error: "message-failed" });
                    return;
                }
                sendResponse?.(response);
            }
        );
    }

    return {
        forwardCallAction,
        forwardRefreshCallState,
        forwardPttCommand
    };
}
