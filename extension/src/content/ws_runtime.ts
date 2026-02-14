import { createWsClient, type WsClient } from "../ws/ws_client";
import { ContentToSwMessageType } from "../messaging/sw_channel";
import { buildPingMessage } from "../ws/ws_codec";
import type { ContentRuntimeState } from "./runtime_state";

export function createContentWsRuntime(deps: {
    state: ContentRuntimeState;
    log: (...args: unknown[]) => void;
    sendToServiceWorker: <T>(message: {
        type: ContentToSwMessageType;
        value?: unknown;
    }) => Promise<T | null>;
    onMessage: (data: Uint8Array) => void;
    onConnected: () => Promise<void>;
}) {
    const { state, log, sendToServiceWorker, onMessage, onConnected } = deps;

    const wsClient: WsClient = createWsClient({
        log,
        buildPingPayload: buildPingMessage,
        onMessage,
        onConnectionChange: (connected) => {
            void sendToServiceWorker({
                type: ContentToSwMessageType.ContentConnectionState,
                value: { isConnected: connected }
            });
            if (connected) {
                void onConnected();
            }
        }
    });

    function buildWsUrl(): string {
        return `ws://127.0.0.1:${state.wsPort}`;
    }

    function canConnect(): boolean {
        return state.isOwner && state.isSubscribed && state.isCompanionEnabled;
    }

    function refreshWsConnection(): void {
        if (!canConnect()) {
            wsClient.disconnect();
            return;
        }
        wsClient.connect(buildWsUrl());
    }

    return {
        wsClient,
        refreshWsConnection
    };
}
