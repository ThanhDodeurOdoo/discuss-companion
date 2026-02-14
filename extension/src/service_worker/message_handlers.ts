import { type CallAction, type CallActionOptions } from "../call_actions";
import { setStoredCallState } from "../call_state";
import type { CallState } from "../call_state_types";
import {
    getAppConnected,
    getCallTabId,
    getIsTalkingByTabId,
    setAppConnected,
    setCallTabId,
    setIsTalkingByTabId
} from "../storage/session_state";
import { IS_FIREFOX_BUILD } from "../env";
import {
    ContentToSwMessageType,
    SwToContentMessageType,
    type SwToContentMessage
} from "../messaging/sw_channel";
import type { PttCommand } from "../page_bridge/runtime_types";
import { createContentForwarders } from "./content_forwarders";
import { createIconStateController } from "./icon_state";
import { createOwnershipController } from "./ownership_state";
import { createShortcutController } from "./shortcuts";
import { createTabFocusController } from "./tab_focus";

interface ExtensionMessage {
    type: string;
    value?: unknown;
}

type MessageHandlerDeps = {
    log: (...args: unknown[]) => void;
};

export type MessageHandlers = {
    handleMessage: (
        request: ExtensionMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void
    ) => void;
    handleCommand: (command: string) => void;
    handleTabRemoved: (tabId: number) => Promise<void>;
    handleActionClicked: () => void;
    updateAppIcon: () => Promise<void>;
};

export function createMessageHandlers({ log }: MessageHandlerDeps): MessageHandlers {
    function sendToContentTab(tabId: number, message: SwToContentMessage): void {
        chrome.tabs.sendMessage(tabId, message);
    }

    const iconState = createIconStateController({
        getAppConnected,
        getIsTalkingByTabId
    });

    const ownership = createOwnershipController({
        setStoredCallState,
        getCallTabId,
        setCallTabId,
        getIsTalkingByTabId,
        sendToContentTab
    });

    const tabFocus = createTabFocusController({
        getCallTabId,
        log
    });

    const forwarders = createContentForwarders({
        focusCallTab: tabFocus.focusCallTab
    });

    const shortcuts = createShortcutController({
        log,
        getIsTalkingByTabId
    });

    async function handleMessage(
        request: ExtensionMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void
    ) {
        const { type, value } = request;
        const tabId = sender.tab ? sender.tab.id : null;

        if (
            !tabId &&
            type !== ContentToSwMessageType.CallAction &&
            type !== ContentToSwMessageType.RefreshCallState &&
            type !== ContentToSwMessageType.PttCommand &&
            type !== ContentToSwMessageType.FocusCallTab
        ) {
            sendResponse?.({ error: "no-tab" });
            return;
        }

        const safeTabId = tabId as number;

        switch (type) {
            case ContentToSwMessageType.Subscribe: {
                const isTalkingByTabId = await getIsTalkingByTabId();
                const previousOwner = await getCallTabId();
                isTalkingByTabId[safeTabId] = false;
                await setIsTalkingByTabId(isTalkingByTabId);
                await ownership.setActiveCallTab(safeTabId);
                if (
                    previousOwner !== null &&
                    previousOwner !== safeTabId &&
                    isTalkingByTabId[previousOwner] !== undefined
                ) {
                    sendToContentTab(previousOwner, {
                        type: SwToContentMessageType.ContentOwnerUpdate,
                        value: { isOwner: false }
                    });
                }
                sendToContentTab(safeTabId, {
                    type: SwToContentMessageType.ContentSubscribe,
                    value: { isOwner: true }
                });
                sendResponse?.({ status: "ok" });
                break;
            }
            case ContentToSwMessageType.Unsubscribe: {
                const isTalkingByTabId = await getIsTalkingByTabId();
                const previousOwner = await getCallTabId();
                delete isTalkingByTabId[safeTabId];
                await setIsTalkingByTabId(isTalkingByTabId);
                const nextOwner = await ownership.syncCallTabIdFromMap(isTalkingByTabId);
                if (previousOwner === safeTabId && nextOwner === null) {
                    await setAppConnected(false);
                }
                await ownership.notifyOwnerChange(previousOwner, nextOwner, isTalkingByTabId);
                sendToContentTab(safeTabId, { type: SwToContentMessageType.ContentUnsubscribe });
                await iconState.updateAppIcon();
                sendResponse?.({ status: "ok" });
                break;
            }
            case ContentToSwMessageType.IsTalking: {
                const isTalkingByTabId = await getIsTalkingByTabId();
                isTalkingByTabId[safeTabId] = value as boolean;
                await setIsTalkingByTabId(isTalkingByTabId);
                if (value === true) {
                    await ownership.setActiveCallTab(safeTabId);
                }
                await iconState.updateAppIcon();
                sendResponse?.({ status: "ok" });
                break;
            }
            case ContentToSwMessageType.CallAction: {
                const callTabId = await getCallTabId();
                if (callTabId === null) {
                    sendResponse?.({ error: "no-call-tab" });
                    break;
                }
                void forwarders.forwardCallAction(
                    callTabId,
                    value as { action?: CallAction; options?: CallActionOptions } | null,
                    sendResponse
                );
                return true;
            }
            case ContentToSwMessageType.RefreshCallState: {
                const callTabId = await getCallTabId();
                if (callTabId === null) {
                    sendResponse?.({ error: "no-call-tab" });
                    break;
                }
                void forwarders.forwardRefreshCallState(callTabId, sendResponse);
                return true;
            }
            case ContentToSwMessageType.PttCommand: {
                const callTabId = await getCallTabId();
                if (callTabId === null) {
                    sendResponse?.({ error: "no-call-tab" });
                    break;
                }
                void forwarders.forwardPttCommand(
                    callTabId,
                    value as { command?: PttCommand } | null,
                    sendResponse
                );
                return true;
            }
            case ContentToSwMessageType.FocusCallTab: {
                const didFocus = await tabFocus.focusCallTab();
                sendResponse?.({ status: "ok", didFocus });
                break;
            }
            case ContentToSwMessageType.ContentConnectionState: {
                if (!tabId || !(await ownership.isOwnerTab(safeTabId))) {
                    sendResponse?.({ status: "ok", ignored: true });
                    break;
                }
                const connected = Boolean(
                    (value as { isConnected?: boolean } | undefined)?.isConnected
                );
                await setAppConnected(connected);
                await iconState.updateAppIcon();
                sendResponse?.({ status: "ok" });
                break;
            }
            case ContentToSwMessageType.ContentCallStateUpdate: {
                if (!tabId || !(await ownership.isOwnerTab(safeTabId))) {
                    sendResponse?.({ status: "ok", ignored: true });
                    break;
                }
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

    function handleCommand(command: string): void {
        void shortcuts.handleCommand(command);
    }

    async function handleTabRemoved(tabId: number): Promise<void> {
        const isTalkingByTabId = await getIsTalkingByTabId();
        const previousOwner = await getCallTabId();
        delete isTalkingByTabId[tabId];
        await setIsTalkingByTabId(isTalkingByTabId);
        if (previousOwner === tabId) {
            await setAppConnected(false);
        }
        const nextOwner = await ownership.syncCallTabIdFromMap(isTalkingByTabId);
        await ownership.notifyOwnerChange(previousOwner, nextOwner, isTalkingByTabId);
        await iconState.updateAppIcon();
    }

    function handleActionClicked(): void {
        if (IS_FIREFOX_BUILD) {
            return;
        }
        chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    }

    return {
        handleMessage,
        handleCommand,
        handleTabRemoved,
        handleActionClicked,
        updateAppIcon: iconState.updateAppIcon
    };
}
