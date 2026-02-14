import { type CallAction, type CallActionOptions } from "@extension/src/call_actions";
import { setStoredCallState } from "@extension/src/call_state";
import type { CallState } from "@extension/src/call_state_types";
import {
    getAppConnected,
    getCallTabId,
    getIsTalkingByTabId,
    setAppConnected,
    setCallTabId,
    setIsTalkingByTabId
} from "@extension/src/storage/session_state";
import { IS_FIREFOX_BUILD } from "@extension/src/env";
import {
    ContentToSwMessageType,
    SwToContentMessageType,
    type SwToContentMessage
} from "@extension/src/messaging/sw_channel";
import type { PttCommand } from "@extension/src/page_bridge/runtime_types";
import { createContentForwarders } from "@extension/src/service_worker/content_forwarders";
import { createIconStateController } from "@extension/src/service_worker/icon_state";
import { createOwnershipController } from "@extension/src/service_worker/ownership_state";
import { createShortcutController } from "@extension/src/service_worker/shortcuts";
import { createTabFocusController } from "@extension/src/service_worker/tab_focus";

/**
 * Runtime message wraper received by the service worker.
 *
 * The concrete `value` shape depends on `type` and is validated/normalized by
 * the branch handling that message type.
 */
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

/**
 * Creates the servic-worker message coordinator.
 *
 * This is the service-worker side integration point for all extension contexts
 * (content scripts, popup, keyboard commands, and tab lifecycle events). The
 * coordinator delegates specialized concerns to focused controllers:
 * - ownership election and owner notifications,
 * - forwarding commands into the owner content tab,
 * - icon state updates from connection/talking status,
 * - tab focusing and shortcut command dispatch.
 *
 * The worker is the authoritative owner of cross-tab session state persisted in
 * storage (`callTabId`, `isTalkingByTabId`, app connection status, cached call
 * state). Content tabs only publish updates  the worker validates ownership
 * before accepting writes that affect shared state
 */
export function createMessageHandlers({ log }: MessageHandlerDeps): MessageHandlers {
    /**
     * elper for service-worker -> content messages.
     *
     * These messages are advisory routing events; if a tab is gone, ownership
     * reconciliation paths will clean up state on subsequent lifecycle updates.
     */
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

    /**
     * Primary message entry point for requests targeting the worker.
     *
     * Message families:
     * - lifecycle coordination from content (`subscribe`, `unsubscribe`, `is-talking`);
     * - command forwarding requests from popup/app pathways (`call-action`,
     *   `refresh-call-state`, `ptt-command`, `focus-call-tab`);
     * - owner-only replication updates (`content-connection-state`,
     *   `content-call-state-update`).
     *
     * Response contract:
     * - returns `true` only when response is fulfilled asynchronously by a
     *   forwarder callback (`sendResponse` kept alive by caller listener);
     * - returns `false`/void for branches that resolve synchronously in this
     *   function after storage/controller operations complete.
     */
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

    /**
     * Handles keyboard shortcut commands (e.g. PTT down/up, togle voice).
     *
     * Shortcut routing is kept separate from `handleMessage` because commands are
     * delivered through browser command events, not runtime messaging.
     */
    function handleCommand(command: string): void {
        void shortcuts.handleCommand(command);
    }

    /**
     * Cleans ownership/session state when a tab is closed.
     *
     * This path mirrors unsubscribe semantics for hard tab teardown:
     * - remove tab from talking map,
     * - reset app-connected state when owner disappears,
     * - elect and notify next owner (if any),
     * - refresh icon state to reflect current aggregate state.
     */
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

    /**
     * Handles toolbar action click behavior.
     *
     * Current policy opens the shortcuts page on Chromium builds, while Firefox
     * keeps this action disabled to match platform-specific product behavior.
     */
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
