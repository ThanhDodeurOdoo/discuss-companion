import type { CallState } from "@extension/src/call_state_types";
import type { BridgeClient } from "@extension/src/messaging/bridge_client";
import { BridgeRequestType } from "@extension/src/messaging/bridge_protocol";
import { ContentToSwMessageType } from "@extension/src/messaging/sw_channel";
import type { WsClient } from "@extension/src/ws/ws_client";
import { buildCallStateMessage, type CallStateSnapshot } from "@extension/src/ws/ws_codec";
import type { ContentRuntimeState } from "@extension/src/content/runtime_state";

export type SendToServiceWorker = <T>(message: {
    type: ContentToSwMessageType;
    value?: unknown;
}) => Promise<T | null>;

function isOkStatusResponse(response: unknown): response is {
    status: "ok";
} {
    if (!response || typeof response !== "object") {
        return false;
    }
    return (response as { status?: unknown }).status === "ok";
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

export function createCallStateSyncRuntime(deps: {
    state: ContentRuntimeState;
    bridge: BridgeClient;
    wsClient: WsClient;
    ensureBridgeReady: () => Promise<void>;
    sendToServiceWorker: SendToServiceWorker;
}) {
    const { state, bridge, wsClient, ensureBridgeReady, sendToServiceWorker } = deps;

    async function sendToServiceWorkerExpectOk(message: {
        type: ContentToSwMessageType;
        value?: unknown;
    }): Promise<boolean> {
        const response = await sendToServiceWorker(message);
        return isOkStatusResponse(response);
    }

    async function sendCallStateToApp(nextState?: CallState | null): Promise<void> {
        if (!wsClient.isConnected()) {
            return;
        }
        const storedState = nextState ?? state.cachedCallState;
        const snapshot = buildCallStateSnapshot(storedState, state.isOwner && state.isSubscribed);
        wsClient.send(buildCallStateMessage(snapshot));
    }

    async function updateCachedCallState(
        nextState: CallState | null,
        options: { forcePersist?: boolean } = {}
    ): Promise<void> {
        state.cachedCallState = nextState;
        const shouldPersist = options.forcePersist || (state.isOwner && state.isSubscribed);
        if (!shouldPersist) {
            return;
        }
        await sendToServiceWorker({
            type: ContentToSwMessageType.ContentCallStateUpdate,
            value: { state: nextState }
        });
    }

    async function refreshAndSendCallState(): Promise<CallState | null> {
        await ensureBridgeReady();
        const response = await bridge.request<{ state?: CallState | null }>(
            BridgeRequestType.ReadCallState
        );
        const nextState = response?.state ?? null;
        if (response) {
            await updateCachedCallState(nextState);
        }
        await sendCallStateToApp(nextState);
        return nextState;
    }

    return {
        sendToServiceWorkerExpectOk,
        sendCallStateToApp,
        updateCachedCallState,
        refreshAndSendCallState
    };
}
