import { createBridgeClient } from "./messaging/bridge_client";
import {
    isExtensionToPageMessage,
    listenToOdooPageMessages,
    sendToOdooPage
} from "./messaging/content_channel";
import { isSwToContentMessage, sendToServiceWorker } from "./messaging/sw_channel";
import {
    type CallAction,
    type CallActionOptions,
    type CallActionResult,
    isCallAction,
    requiresFocusCallTab
} from "./call_actions";
import { parseAppCommand, resolveAppCommandAction } from "./app_commands";
import type { CallState } from "./call_state_types";
import { isCallStateObserverPayload } from "./type_guards";
import { readLocalSettings } from "./storage/local_settings";
import { injectScriptOnce } from "./utils/dom_inject";
import { createWsClient } from "./ws/ws_client";
import {
    buildCallStateMessage,
    buildPingMessage,
    parseWsMessage,
    type CallStateSnapshot
} from "./ws/ws_codec";

const BRIDGE_SCRIPT_ID = "__discuss_companion_page_bridge__";
const CALL_STATE_OBSERVER_ACTIVE_DELAY = 1000;
const CALL_STATE_OBSERVER_IDLE_DELAY = 5000;
const CALL_INFO_CAPTURE_DELAY = 3000;

const mutedLog = (..._args: unknown[]) => {};
let logTarget: (...args: unknown[]) => void = mutedLog;
const log = (...args: unknown[]) => logTarget(...args);

let wsPort = 49152;
let isCompanionEnabled = false;
let isOwner = false;
let isSubscribed = false;
let bridgeReady: Promise<void> | null = null;
let cachedCallState: CallState | null = null;

const bridge = createBridgeClient();

const wsClient = createWsClient({
    log,
    buildPingPayload: buildPingMessage,
    onMessage: handleWsMessage,
    onConnectionChange: (connected) => {
        void sendToServiceWorker({
            type: "content-connection-state",
            value: { isConnected: connected }
        });
        if (connected) {
            void sendCallStateToApp();
        }
    }
});

function buildWsUrl() {
    return `ws://127.0.0.1:${wsPort}`;
}

function canConnect() {
    return isOwner && isSubscribed && isCompanionEnabled;
}

function refreshWsConnection() {
    if (!canConnect()) {
        wsClient.disconnect();
        return;
    }
    wsClient.connect(buildWsUrl());
}

async function ensureBridgeReady(): Promise<void> {
    if (!bridgeReady) {
        bridgeReady = injectScriptOnce(
            chrome.runtime.getURL("page_bridge.js"),
            BRIDGE_SCRIPT_ID
        ).catch((error) => {
            log("[Content] Failed to inject page bridge", error);
            throw error;
        });
    }
    await bridgeReady;
}

function buildCallStateSnapshot(
    state: CallState | null | undefined,
    hasCall: boolean
): CallStateSnapshot {
    return {
        hasCall,
        hasState: Boolean(state),
        isMute: Boolean(state?.isMute),
        isDeaf: Boolean(state?.isDeaf),
        isCameraOn: Boolean(state?.isCameraOn),
        isScreenOn: Boolean(state?.isScreenOn)
    };
}

async function sendCallStateToApp(state?: CallState | null): Promise<void> {
    if (!wsClient.isConnected()) {
        return;
    }
    const storedState = state ?? cachedCallState;
    const snapshot = buildCallStateSnapshot(storedState, isOwner && isSubscribed);
    wsClient.send(buildCallStateMessage(snapshot));
}

async function updateCachedCallState(state: CallState | null): Promise<void> {
    cachedCallState = state;
    await sendToServiceWorker({
        type: "content-call-state-update",
        value: { state }
    });
}

async function refreshAndSendCallState(): Promise<CallState | null> {
    await ensureBridgeReady();
    const response = await bridge.request<{ state?: CallState | null }>("read-call-state");
    const state = response?.state ?? null;
    if (response) {
        await updateCachedCallState(state);
    }
    await sendCallStateToApp(state);
    return state;
}

async function startObserver(): Promise<void> {
    await ensureBridgeReady();
    await bridge.request("start-observer", {
        activeDelay: CALL_STATE_OBSERVER_ACTIVE_DELAY,
        idleDelay: CALL_STATE_OBSERVER_IDLE_DELAY
    });
}

async function stopObserver(): Promise<void> {
    await ensureBridgeReady();
    await bridge.request("stop-observer");
}

function scheduleCallInfoCapture(): void {
    window.setTimeout(async () => {
        try {
            await ensureBridgeReady();
            const info = await bridge.request<{
                channelId?: number;
                channelName?: string;
                origin?: string;
            }>("get-call-info");
            if (info?.channelId && info.origin) {
                const url = new URL("/odoo/action-mail.action_discuss", info.origin);
                url.searchParams.set("active_id", `discuss.channel_${info.channelId}`);
                url.searchParams.set("call", "accept");
                const lastJoinedCall = {
                    url: url.toString(),
                    name: info.channelName || "last call"
                };
                await chrome.storage.local.set({ lastJoinedCall });
                log("[Content] Captured call info", lastJoinedCall);
            }
        } catch (error) {
            log("[Content] Failed to capture call info", error);
        }
    }, CALL_INFO_CAPTURE_DELAY);
}

async function runCallAction(
    action: CallAction,
    options: CallActionOptions = {}
): Promise<CallActionResult> {
    if (requiresFocusCallTab(action) || options.focusCallTab) {
        await sendToServiceWorker({ type: "focus-call-tab" });
    }
    await ensureBridgeReady();
    const response = await bridge.request<{ didRun?: boolean; state?: CallState | null }>(
        "call-action",
        { action }
    );
    const didRun = Boolean(response?.didRun);
    const state = response?.state ?? null;
    if (response) {
        await updateCachedCallState(state);
    }
    await sendCallStateToApp(state);
    return { didRun, state: state ?? undefined };
}

async function handleStatusState(rawState?: string | null): Promise<void> {
    const command = parseAppCommand(rawState);
    if (!command) {
        return;
    }
    if (command.name === "focus-call-tab" || command.name === "go-to-call") {
        await sendToServiceWorker({ type: "focus-call-tab" });
        await sendCallStateToApp();
        return;
    }
    if (command.name === "refresh-call-state") {
        await refreshAndSendCallState();
        return;
    }
    const action = resolveAppCommandAction(command.name, command.value, log);
    if (!action) {
        return;
    }
    await runCallAction(action);
}

function handleWsMessage(data: Uint8Array) {
    const message = parseWsMessage(data);
    if (!message) {
        return;
    }
    switch (message.type) {
        case "ptt-down":
            sendToOdooPage({ from: "discuss-push-to-talk", type: "push-to-talk-pressed" });
            break;
        case "ptt-up":
            sendToOdooPage({ from: "discuss-push-to-talk", type: "push-to-talk-released" });
            break;
        case "status":
            void handleStatusState(message.state);
            break;
        case "pong":
            break;
    }
}

function handleBridgeCallStateEvent(payload: unknown): void {
    if (!isCallStateObserverPayload(payload)) {
        return;
    }
    const state = payload.hasState ? (payload.state ?? null) : null;
    void updateCachedCallState(state).then(() => sendCallStateToApp(state));
}

bridge.onEvent("call-state-update", handleBridgeCallStateEvent);

async function applySubscriptionChange(nextOwner: boolean, subscribed: boolean): Promise<void> {
    const wasOwner = isOwner;
    const wasSubscribed = isSubscribed;
    isOwner = nextOwner;
    isSubscribed = subscribed;

    if (isOwner && isSubscribed) {
        await ensureBridgeReady();
        await startObserver();
        scheduleCallInfoCapture();
        refreshWsConnection();
        await refreshAndSendCallState();
        return;
    }

    if (wasOwner && wasSubscribed) {
        await sendCallStateToApp(null);
        await stopObserver();
    }
    wsClient.disconnect();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (sender?.id === chrome.runtime.id && isExtensionToPageMessage(request)) {
        sendToOdooPage(request);
        return;
    }

    if (!isSwToContentMessage(request)) {
        return;
    }

    switch (request.type) {
        case "content-subscribe":
            void applySubscriptionChange(request.value.isOwner, true);
            break;
        case "content-unsubscribe":
            void applySubscriptionChange(false, false).then(() => {
                void updateCachedCallState(null);
            });
            break;
        case "content-owner-update":
            void applySubscriptionChange(request.value.isOwner, true);
            break;
        case "content-call-action":
            if (!isCallAction(request.value.action)) {
                sendResponse?.({ error: "invalid-action" });
                break;
            }
            void runCallAction(request.value.action, request.value.options).then((result) => {
                sendResponse?.({ status: "ok", didRun: result.didRun, state: result.state });
            });
            return true;
        case "content-refresh-call-state":
            void refreshAndSendCallState().then((state) => {
                sendResponse?.({ status: "ok", state });
            });
            return true;
    }

    return false;
});

listenToOdooPageMessages(({ type, value }) => {
    chrome.runtime.sendMessage({ type, value }, (response) => {
        if (chrome.runtime.lastError) {
            console.warn(
                "[PTT-Bridge] Error sending to service worker:",
                chrome.runtime.lastError.message
            );
            return;
        }
        if (type === "ask-version" && response) {
            sendToOdooPage({
                from: "discuss-push-to-talk",
                type: "answer-version",
                value: response
            });
        }
    });
});

void (async () => {
    const settings = await readLocalSettings();
    wsPort = settings.wsPort;
    isCompanionEnabled = settings.isCompanionEnabled;
    logTarget = settings.isLoggingEnabled ? console.log : mutedLog;

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") {
            return;
        }
        if (changes.wsPort) {
            wsPort = changes.wsPort.newValue as number;
            wsClient.disconnect();
            refreshWsConnection();
        }
        if (changes.isLoggingEnabled) {
            logTarget = changes.isLoggingEnabled.newValue ? console.log : mutedLog;
        }
        if (changes.isCompanionEnabled) {
            isCompanionEnabled = Boolean(changes.isCompanionEnabled.newValue);
            refreshWsConnection();
        }
    });
})();
