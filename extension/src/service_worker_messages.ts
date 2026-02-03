import {
    isCallAction,
    requiresFocusCallTab,
    type CallAction,
    type CallActionOptions
} from "./call_actions";
import { setStoredCallState } from "./call_state";
import type { CallState } from "./call_state_types";
import {
    getAppConnected,
    getCallTabId,
    getIsTalkingByTabId,
    setAppConnected,
    setCallTabId,
    setIsTalkingByTabId
} from "./storage/session_state";
import { type SwToContentMessage } from "./messaging/sw_channel";
import { throttle } from "./utils";
import { IS_FIREFOX_BUILD } from "./env";

const ACTIVE_ONLINE_ICON = "/assets/icons/active_online_icon.png";
const INACTIVE_ONLINE_ICON = "/assets/icons/inactive_online_icon.png";
const INACTIVE_OFFLINE_ICON = "/assets/icons/inactive_offline_icon.png";

interface ExtensionMessage {
    type: string;
    value?: unknown;
}

type MessageHandlerDeps = {
    log: (...args: unknown[]) => void;
};

type Command = "ptt-pressed" | "ptt-released" | "toggle-voice";

export type MessageHandlers = {
    handleMessage: (
        request: ExtensionMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void
    ) => void;
    handleCommand: (command: string) => void;
    handleCommandImmediate: (command: string) => void;
    handleTabRemoved: (tabId: number) => void;
    handleActionClicked: () => void;
    updateAppIcon: () => Promise<void>;
};

export function createMessageHandlers({ log }: MessageHandlerDeps): MessageHandlers {
    function pickFirstTabId(isTalkingByTabId: Record<string, boolean>): number | null {
        const tabIds = Object.keys(isTalkingByTabId);
        if (tabIds.length === 0) {
            return null;
        }
        const tabId = Number(tabIds[0]);
        return Number.isNaN(tabId) ? null : tabId;
    }

    async function setActiveCallTab(tabId: number | null): Promise<void> {
        const currentTabId = await getCallTabId();
        if (currentTabId === tabId) {
            return;
        }
        await setCallTabId(tabId);
        await setStoredCallState(null);
    }

    async function syncCallTabIdFromMap(
        isTalkingByTabId: Record<string, boolean>
    ): Promise<number | null> {
        const currentTabId = await getCallTabId();
        if (currentTabId !== null && isTalkingByTabId[currentTabId] !== undefined) {
            return currentTabId;
        }
        const nextTabId = pickFirstTabId(isTalkingByTabId);
        await setActiveCallTab(nextTabId);
        return nextTabId;
    }

    async function updateAppIcon() {
        const connected = await getAppConnected();
        if (!connected) {
            chrome.action.setIcon({ path: INACTIVE_OFFLINE_ICON });
            return;
        }

        const isTalkingByTabId = await getIsTalkingByTabId();
        const isTalking = Object.values(isTalkingByTabId).some(Boolean);
        chrome.action.setIcon({ path: isTalking ? ACTIVE_ONLINE_ICON : INACTIVE_ONLINE_ICON });
    }

    function sendToContentTab(tabId: number, message: SwToContentMessage): void {
        chrome.tabs.sendMessage(tabId, message);
    }

    async function notifyOwnerChange(
        previousOwner: number | null,
        nextOwner: number | null,
        isTalkingByTabId: Record<string, boolean>
    ) {
        if (nextOwner !== null && nextOwner !== previousOwner) {
            sendToContentTab(nextOwner, {
                type: "content-owner-update",
                value: { isOwner: true }
            });
        }
        if (
            previousOwner !== null &&
            previousOwner !== nextOwner &&
            isTalkingByTabId[previousOwner] !== undefined
        ) {
            sendToContentTab(previousOwner, {
                type: "content-owner-update",
                value: { isOwner: false }
            });
        }
    }

    async function forwardCallAction(
        tabId: number,
        payload: { action?: CallAction; options?: CallActionOptions } | null,
        sendResponse: (response?: unknown) => void
    ) {
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
    ) {
        chrome.tabs.sendMessage(tabId, { type: "content-refresh-call-state" }, (response) => {
            if (chrome.runtime.lastError) {
                sendResponse?.({ error: "message-failed" });
                return;
            }
            sendResponse?.(response);
        });
    }

    async function handleMessage(
        request: ExtensionMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void
    ) {
        const { type, value } = request;
        const tabId = sender.tab ? sender.tab.id : null;

        if (
            !tabId &&
            type !== "ask-version" &&
            type !== "call-action" &&
            type !== "refresh-call-state" &&
            type !== "focus-call-tab" &&
            type !== "content-connection-state"
        ) {
            sendResponse?.({ error: "no-tab" });
            return;
        }

        const safeTabId = tabId as number;

        switch (type) {
            case "subscribe": {
                const isTalkingByTabId = await getIsTalkingByTabId();
                const previousOwner = await getCallTabId();
                isTalkingByTabId[safeTabId] = false;
                await setIsTalkingByTabId(isTalkingByTabId);
                const nextOwner = await syncCallTabIdFromMap(isTalkingByTabId);
                if (previousOwner !== nextOwner && nextOwner !== null && nextOwner !== safeTabId) {
                    sendToContentTab(nextOwner, {
                        type: "content-owner-update",
                        value: { isOwner: true }
                    });
                }
                sendToContentTab(safeTabId, {
                    type: "content-subscribe",
                    value: { isOwner: nextOwner === safeTabId }
                });
                sendResponse?.({ status: "ok" });
                break;
            }
            case "unsubscribe": {
                const isTalkingByTabId = await getIsTalkingByTabId();
                const previousOwner = await getCallTabId();
                delete isTalkingByTabId[safeTabId];
                await setIsTalkingByTabId(isTalkingByTabId);
                const nextOwner = await syncCallTabIdFromMap(isTalkingByTabId);
                await notifyOwnerChange(previousOwner, nextOwner, isTalkingByTabId);
                sendToContentTab(safeTabId, { type: "content-unsubscribe" });
                await updateAppIcon();
                sendResponse?.({ status: "ok" });
                break;
            }
            case "is-talking": {
                const isTalkingByTabId = await getIsTalkingByTabId();
                isTalkingByTabId[safeTabId] = value as boolean;
                await setIsTalkingByTabId(isTalkingByTabId);
                if (value === true) {
                    await setActiveCallTab(safeTabId);
                }
                await updateAppIcon();
                sendResponse?.({ status: "ok" });
                break;
            }
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
            case "call-action": {
                const callTabId = await getCallTabId();
                if (callTabId === null) {
                    sendResponse?.({ error: "no-call-tab" });
                    break;
                }
                void forwardCallAction(
                    callTabId,
                    value as { action?: CallAction; options?: CallActionOptions } | null,
                    sendResponse
                );
                return true;
            }
            case "refresh-call-state": {
                const callTabId = await getCallTabId();
                if (callTabId === null) {
                    sendResponse?.({ error: "no-call-tab" });
                    break;
                }
                void forwardRefreshCallState(callTabId, sendResponse);
                return true;
            }
            case "focus-call-tab": {
                const didFocus = await focusCallTab();
                sendResponse?.({ status: "ok", didFocus });
                break;
            }
            case "content-connection-state": {
                const connected = Boolean(
                    (value as { isConnected?: boolean } | undefined)?.isConnected
                );
                await setAppConnected(connected);
                await updateAppIcon();
                sendResponse?.({ status: "ok" });
                break;
            }
            case "content-call-state-update": {
                const state = (value as { state?: CallState | null } | undefined)?.state ?? null;
                await setStoredCallState(state);
                sendResponse?.({ status: "ok" });
                break;
            }
            default: {
                sendResponse?.({ error: "unknown-type" });
            }
        }

        return false;
    }

    async function focusCallTab(): Promise<boolean> {
        const tabId = await getCallTabId();
        if (tabId === null) {
            return false;
        }
        try {
            const tab = await chrome.tabs.get(tabId);
            if (!tab) {
                return false;
            }
            await chrome.tabs.update(tabId, { active: true });
            await chrome.windows.update(tab.windowId, { focused: true });
            return true;
        } catch (error) {
            log("Failed to focus tab", error);
        }
        return false;
    }

    async function onCommand(command: string) {
        if (IS_FIREFOX_BUILD) {
            return;
        }
        log("[BG] onCommand", command);
        const isTalkingByTabId = await getIsTalkingByTabId();
        const tabIds = Object.keys(isTalkingByTabId);
        for (const tabIdStr of tabIds) {
            const tabId = Number(tabIdStr);
            switch (command as Command) {
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

    function handleTabRemoved(tabId: number) {
        return (async () => {
            const isTalkingByTabId = await getIsTalkingByTabId();
            const previousOwner = await getCallTabId();
            delete isTalkingByTabId[tabId];
            await setIsTalkingByTabId(isTalkingByTabId);
            if (previousOwner === tabId) {
                await setAppConnected(false);
            }
            const nextOwner = await syncCallTabIdFromMap(isTalkingByTabId);
            await notifyOwnerChange(previousOwner, nextOwner, isTalkingByTabId);
            await updateAppIcon();
        })();
    }

    function handleActionClicked() {
        if (IS_FIREFOX_BUILD) {
            return;
        }
        chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    }

    const throttledCommand = throttle(onCommand, 150);

    return {
        handleMessage,
        handleCommand: throttledCommand,
        handleCommandImmediate: onCommand,
        handleTabRemoved,
        handleActionClicked,
        updateAppIcon
    };
}
