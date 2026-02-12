import { createBridgeClient } from "./messaging/bridge_client";
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
import {
    isCallLifecycleObserverPayload,
    isCallStateObserverPayload,
    isPttCommandPayload
} from "./type_guards";
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
const CALL_INFO_CAPTURE_DELAY = 3000;

const mutedLog = (..._args: unknown[]) => {};
let logTarget: (...args: unknown[]) => void = mutedLog;
const log = (...args: unknown[]) => logTarget(...args);

let wsPort = 49152;
let isCompanionEnabled = false;
let isOwner = false;
let isSubscribed = false;
let hasHostedCall = false;
let hasStartedStoreWatch = false;

let bridgeReady: Promise<void> | null = null;
let lifecycleQueue: Promise<void> = Promise.resolve();
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

async function maybeStartStoreWatch(): Promise<void> {
    if (hasStartedStoreWatch) {
        return;
    }
    await ensureBridgeReady();
    const result = await bridge.request<{ running?: boolean }>("start-store-watch");
    hasStartedStoreWatch = Boolean(result?.running);
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

async function updateCachedCallState(
    state: CallState | null,
    options: { forcePersist?: boolean } = {}
): Promise<void> {
    cachedCallState = state;
    const shouldPersist = options.forcePersist || (isOwner && isSubscribed);
    if (!shouldPersist) {
        return;
    }
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

async function sendPttCommand(command: "ptt-down" | "ptt-up" | "toggle-voice"): Promise<void> {
    await ensureBridgeReady();
    await bridge.request("ptt-command", { command });
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
            void sendPttCommand("ptt-down");
            break;
        case "ptt-up":
            void sendPttCommand("ptt-up");
            break;
        case "status":
            void handleStatusState(message.state);
            break;
        case "pong":
            break;
    }
}

function queueLifecycleUpdate(payload: unknown): void {
    lifecycleQueue = lifecycleQueue
        .then(() => applyLifecycleUpdate(payload))
        .catch((error) => log("[Content] Failed to process lifecycle update", error));
}

async function applyLifecycleUpdate(payload: unknown): Promise<void> {
    if (!isCallLifecycleObserverPayload(payload)) {
        return;
    }

    const hadHostedCall = hasHostedCall;
    hasHostedCall = payload.hasHostedCall;

    if (hasHostedCall && !hadHostedCall) {
        await sendToServiceWorker({ type: "subscribe" });
        scheduleCallInfoCapture();
    }

    if (!hasHostedCall && hadHostedCall) {
        await sendToServiceWorker({ type: "is-talking", value: false });
        await sendToServiceWorker({ type: "unsubscribe" });
        await updateCachedCallState(null, { forcePersist: true });
    }

    if (hasHostedCall) {
        await sendToServiceWorker({ type: "is-talking", value: payload.isTalking });
    }

    if (!payload.hasRtcService && !payload.hasHostedCall) {
        wsClient.disconnect();
    }
}

function handleBridgeCallStateEvent(payload: unknown): void {
    if (!isCallStateObserverPayload(payload)) {
        return;
    }
    const state = payload.hasState ? (payload.state ?? null) : null;
    void updateCachedCallState(state).then(() => sendCallStateToApp(state));
}

bridge.onEvent("call-lifecycle-update", queueLifecycleUpdate);
bridge.onEvent("call-state-update", handleBridgeCallStateEvent);

async function applySubscriptionChange(nextOwner: boolean, subscribed: boolean): Promise<void> {
    const wasOwner = isOwner;
    const wasSubscribed = isSubscribed;
    isOwner = nextOwner;
    isSubscribed = subscribed;

    if (isOwner && isSubscribed) {
        await ensureBridgeReady();
        refreshWsConnection();
        await refreshAndSendCallState();
        return;
    }

    if (wasOwner && wasSubscribed) {
        await sendCallStateToApp(null);
        await updateCachedCallState(null, { forcePersist: true });
    }
    wsClient.disconnect();
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (!isSwToContentMessage(request)) {
        return;
    }

    switch (request.type) {
        case "content-subscribe":
            void applySubscriptionChange(request.value.isOwner, true);
            break;
        case "content-unsubscribe":
            void applySubscriptionChange(false, false).then(() => {
                void updateCachedCallState(null, { forcePersist: true });
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
        case "content-ptt-command":
            if (!isPttCommandPayload(request.value)) {
                sendResponse?.({ error: "invalid-command" });
                break;
            }
            void sendPttCommand(request.value.command).then(() => {
                sendResponse?.({ status: "ok" });
            });
            return true;
    }

    return false;
});

void (async () => {
    const settings = await readLocalSettings();
    wsPort = settings.wsPort;
    isCompanionEnabled = settings.isCompanionEnabled;
    logTarget = settings.isLoggingEnabled ? console.log : mutedLog;

    await maybeStartStoreWatch();
    window.addEventListener(
        "load",
        () => {
            void maybeStartStoreWatch();
        },
        { once: true }
    );
    window.addEventListener("focus", () => {
        void maybeStartStoreWatch();
    });
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            void maybeStartStoreWatch();
        }
    });

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
