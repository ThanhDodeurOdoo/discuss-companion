import {
    executeCallAction,
    focusCallTab,
    refreshCallState,
    type CallAction,
    isCallAction,
    type CallActionOptions
} from "./call_actions";
import { getCallTabId, setCallTabId, setStoredCallState } from "./call_state";
import {
    parseAppCommand,
    resolveAppCommandAction,
    type ParsedAppCommand
} from "./service_worker_app_commands";
import { throttle } from "./utils";

const ACTIVE_ONLINE_ICON = "/assets/icons/active_online_icon.png";
const INACTIVE_ONLINE_ICON = "/assets/icons/inactive_online_icon.png";
const INACTIVE_OFFLINE_ICON = "/assets/icons/inactive_offline_icon.png";

interface IsTalkingMap {
    [tabId: number]: boolean;
}

interface ExtensionMessage {
    type: string;
    value?: unknown;
}

type MessageHandlerDeps = {
    log: (...args: unknown[]) => void;
    isConnected: () => boolean;
};

type Command = "ptt-pressed" | "ptt-released" | "toggle-voice";

export type MessageHandlers = {
    handleMessage: (
        request: ExtensionMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void
    ) => void;
    handleStatusState: (rawState?: string | null) => void;
    handleCommand: (command: string) => void;
    handleCommandImmediate: (command: string) => void;
    handleTabRemoved: (tabId: number) => void;
    handleActionClicked: () => void;
    updateAppIcon: () => Promise<void>;
};

export function createMessageHandlers({ log, isConnected }: MessageHandlerDeps): MessageHandlers {
    function pickFirstTabId(isTalkingByTabId: IsTalkingMap): number | null {
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

    async function syncCallTabIdFromMap(isTalkingByTabId: IsTalkingMap): Promise<void> {
        const currentTabId = await getCallTabId();
        if (currentTabId !== null && isTalkingByTabId[currentTabId] !== undefined) {
            return;
        }
        const nextTabId = pickFirstTabId(isTalkingByTabId);
        await setActiveCallTab(nextTabId);
    }

    async function getIsTalkingByTabId(): Promise<IsTalkingMap> {
        const { isTalkingByTabId = {} } = await chrome.storage.session.get();
        return isTalkingByTabId as IsTalkingMap;
    }

    async function updateAppIcon() {
        if (!isConnected()) {
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
                        const channel = store?.rtc?.channel as
                            | { id: number; name: string }
                            | undefined;
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

    async function handleAppCommand(command: ParsedAppCommand): Promise<void> {
        const action = resolveAppCommandAction(command.name, command.value, log);
        if (!action) {
            return;
        }
        await executeCallAction(action);
    }

    async function handleStatusState(rawState?: string | null): Promise<void> {
        const command = parseAppCommand(rawState);
        if (command) {
            await handleAppCommand(command);
        }
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
            type !== "focus-call-tab"
        ) {
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
                    await setActiveCallTab(safeTabId);
                    delayedSubscribe(safeTabId);
                    sendResponse?.({ status: "ok" });
                }
                break;
            case "unsubscribe":
                {
                    const isTalkingByTabId = await getIsTalkingByTabId();
                    delete isTalkingByTabId[safeTabId];
                    await chrome.storage.session.set({ isTalkingByTabId });
                    await syncCallTabIdFromMap(isTalkingByTabId);
                    await updateAppIcon();
                    sendResponse?.({ status: "ok" });
                }
                break;
            case "is-talking":
                {
                    const isTalkingByTabId = await getIsTalkingByTabId();
                    isTalkingByTabId[safeTabId] = value as boolean;
                    await chrome.storage.session.set({ isTalkingByTabId });
                    if (value === true) {
                        await setActiveCallTab(safeTabId);
                    }
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
            case "call-action":
                {
                    const payload = value as {
                        action?: CallAction;
                        options?: CallActionOptions;
                    } | null;
                    const action = payload?.action;
                    if (!action || !isCallAction(action)) {
                        sendResponse?.({ error: "invalid-action" });
                        break;
                    }
                    const focusCallTab = Boolean(payload?.options?.focusCallTab);
                    const { didRun, state } = await executeCallAction(action, { focusCallTab });
                    sendResponse?.({ status: "ok", didRun, state });
                }
                break;
            case "refresh-call-state":
                {
                    const state = await refreshCallState();
                    sendResponse?.({ status: "ok", state });
                }
                break;
            case "focus-call-tab":
                {
                    const didFocus = await focusCallTab();
                    sendResponse?.({ status: "ok", didFocus });
                }
                break;
            default: {
                const action = resolveAppCommandAction(type, value, log);
                if (action) {
                    const { didRun, state } = await executeCallAction(action);
                    sendResponse?.({ status: "ok", didRun, state });
                    break;
                }
                sendResponse?.({ error: "unknown-type" });
            }
        }
    }

    async function onCommand(command: string) {
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

    const throttledCommand = throttle(onCommand, 150);

    async function handleTabRemoved(tabId: number) {
        const isTalkingByTabId = await getIsTalkingByTabId();
        delete isTalkingByTabId[tabId];
        await chrome.storage.session.set({ isTalkingByTabId });
        await syncCallTabIdFromMap(isTalkingByTabId);
        await updateAppIcon();
    }

    function handleActionClicked() {
        const isFirefox = /Firefox/i.test(navigator.userAgent);
        if (isFirefox) {
            chrome.tabs.create({ url: "about:addons" });
            return;
        }
        chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    }

    return {
        handleMessage,
        handleStatusState,
        handleCommand: throttledCommand,
        handleCommandImmediate: onCommand,
        handleTabRemoved,
        handleActionClicked,
        updateAppIcon
    };
}
