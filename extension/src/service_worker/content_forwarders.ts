import {
    isCallAction,
    requiresFocusCallTab,
    type CallAction,
    type CallActionOptions
} from "@extension/src/call_actions";
import { SwToContentMessageType } from "@extension/src/messaging/sw_channel";
import { isPttCommand, type PttCommand } from "@extension/src/page_bridge/runtime_types";

export function createContentForwarders(deps: { focusCallTab: () => Promise<boolean> }) {
    const { focusCallTab } = deps;

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
            { type: SwToContentMessageType.ContentCallAction, value: payload },
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
        chrome.tabs.sendMessage(
            tabId,
            { type: SwToContentMessageType.ContentRefreshCallState },
            (response) => {
                if (chrome.runtime.lastError) {
                    sendResponse?.({ error: "message-failed" });
                    return;
                }
                sendResponse?.(response);
            }
        );
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
            { type: SwToContentMessageType.ContentPttCommand, value: { command } },
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
