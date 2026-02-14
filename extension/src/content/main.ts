import { createBridgeClient } from "../messaging/bridge_client";
import { BridgeEventType } from "../messaging/bridge_protocol";
import { sendToServiceWorker } from "../messaging/sw_channel";
import type { CallState } from "../call_state_types";
import { createBridgeWatchRuntime } from "./bridge_watch";
import { createCallControlsRuntime } from "./call_controls";
import { createCallInfoCaptureController } from "./call_info_capture";
import { createCallStateSyncRuntime } from "./call_state_sync";
import { createLifecycleSyncRuntime } from "./lifecycle_sync";
import { createLogger, createContentRuntimeState } from "./runtime_state";
import { initializeContentSettingsRuntime } from "./settings_runtime";
import { registerSwMessageRouter } from "./sw_message_router";
import { createContentWsRuntime } from "./ws_runtime";

/**
 * Composition root for the content script runtime.
 *
 * This runtime is the integration hub betwen three boundaries:
 * - in-page bridge events/requests (Odoo context),
 * - extension service-worker transport,
 * - websocket traffic to the native companion app.
 *
 * flow:
 * - page updates -> bridge events -> lifecycle/call-state processors;
 * - service-worker messages -> router -> runtime capabilities;
 * - websocket frames -> call-controls protocol handlers;
 * - local state changes -> synced back to app/service worker as needed.
 */
export function startContentRuntime(): void {
    /**
     * Shared state bag and logger factory.
     *
     * Every module receives the same state reference to avoid duplicated caches
     * of connection flags, lifecycle snapshots, and diagnostic toggles.
     */
    const state = createContentRuntimeState();
    const log = createLogger(state);

    /**
     * Structured request/event channel to the page-bridge script injected in the
     * page context. All Odoo-specific reads/writes go through this boundary.
     */
    const bridge = createBridgeClient();

    /**
     * Bridge readiness and store-watch coordination.
     *
     * This runtime prevents premature bridge calls and centralizes the policy for
     * starting/stopping observation of Odoo store updates.
     */
    const bridgeWatch = createBridgeWatchRuntime(state, bridge, log);

    /**
     * Defered function references break dependency cycles between subsystems:
     * - WS `onConnected` needs latest "send call state to app" implementation;
     * - WS `onMessage` handler is implemented by call-controls runtime.
     *
     * They start as no-op and are assigned once the dependent modules are built.
     */
    let sendCallStateToAppRef: (nextState?: CallState | null) => Promise<void> = async () => {};
    let handleWsMessageRef: (data: Uint8Array) => void = () => {};

    /**
     * Native app websocket runtime.
     *
     * Responsibilities:
     * - connection management (connect/reconnect/disconnect),
     * - forwarding WS payloads to higher-level protocol handlers,
     * - notifying sync layer when transport becomes available.
     */
    const wsRuntime = createContentWsRuntime({
        state,
        log,
        sendToServiceWorker,
        onMessage: (data) => handleWsMessageRef(data),
        onConnected: async () => {
            await sendCallStateToAppRef();
        }
    });

    /**
     * Canonical call-state synchronization engine.
     *
     * This module owns conversion from observed call state to outbound app/state
     * updates, plus cache reconciliation used by lifecycle and command handlers.
     */
    const callStateSync = createCallStateSyncRuntime({
        state,
        bridge,
        wsClient: wsRuntime.wsClient,
        ensureBridgeReady: bridgeWatch.ensureBridgeReady,
        sendToServiceWorker
    });
    sendCallStateToAppRef = callStateSync.sendCallStateToApp;

    /**
     * Call-info capture controller.
     *
     * Lifecycle transitions can require delayed metadata reads (channel/context
     * info) once the page bridge is ready. This controller encapsulates capture
     * scheduling and cancellation semantics.
     */
    const callInfoCapture = createCallInfoCaptureController({
        state,
        ensureBridgeReady: bridgeWatch.ensureBridgeReady,
        bridge,
        log
    });

    /**
     * Lifecycle synchronization runtime.
     *
     * Consumes lifecycle events, serializes update handling, and coordinates
     * recovery behaviors such as resync scheduling, call-info capture, cache
     * invalidation, and websocket teardown.
     */
    const lifecycleSync = createLifecycleSyncRuntime({
        state,
        log,
        sendToServiceWorkerExpectOk: callStateSync.sendToServiceWorkerExpectOk,
        updateCachedCallState: callStateSync.updateCachedCallState,
        scheduleCallInfoCapture: callInfoCapture.scheduleCallInfoCapture,
        clearCallInfoCapture: callInfoCapture.clearCallInfoCapture,
        disconnectWs: () => wsRuntime.wsClient.disconnect()
    });

    /**
     * Call-controls runtime.
     *
     * Handles control commands and protocol messages from multiple sources
     * (bridge events, SW requests, websocket payloads), then updates cached state
     * and propagates authoritative state snapshots back to the native app.
     */
    const callControls = createCallControlsRuntime({
        state,
        bridge,
        ensureBridgeReady: bridgeWatch.ensureBridgeReady,
        updateCachedCallState: callStateSync.updateCachedCallState,
        sendCallStateToApp: callStateSync.sendCallStateToApp,
        refreshAndSendCallState: callStateSync.refreshAndSendCallState,
        sendToServiceWorker,
        log
    });
    handleWsMessageRef = callControls.handleWsMessage;

    bridge.onEvent(BridgeEventType.CallLifecycleUpdate, lifecycleSync.queueLifecycleUpdate);
    bridge.onEvent(BridgeEventType.CallStateUpdate, callControls.handleBridgeCallStateEvent);

    /**
     * Service-worker message entry point.
     *
     * The router receive a narrow capability object instead of raw subsystem
     * instances, which keeps coupling low and makes message routing contracts
     * explicit/testable.
     */
    registerSwMessageRouter({
        state,
        ensureBridgeReady: bridgeWatch.ensureBridgeReady,
        refreshWsConnection: wsRuntime.refreshWsConnection,
        refreshAndSendCallState: callStateSync.refreshAndSendCallState,
        sendCallStateToApp: callStateSync.sendCallStateToApp,
        updateCachedCallState: callStateSync.updateCachedCallState,
        clearCallInfoCapture: callInfoCapture.clearCallInfoCapture,
        disconnectWs: () => wsRuntime.wsClient.disconnect(),
        scheduleLifecycleResync: lifecycleSync.scheduleLifecycleResync,
        hasHostedCall: () => state.hasHostedCall,
        hasLastLifecyclePayload: () => Boolean(state.lastLifecyclePayload),
        handleContentMessage: callControls.handleContentMessage
    });

    /**
     * Runtime settings bootstrap + live updates.
     *
     * Applies persisted settings on startup (logging, watch behavior, transport
     * preferences) and keeps runtime behavior synchronized when settings change.
     */
    void initializeContentSettingsRuntime({
        state,
        setLoggerTarget: (target) => {
            state.logTarget = target;
        },
        maybeStartStoreWatch: bridgeWatch.maybeStartStoreWatch,
        maybeStopStoreWatch: bridgeWatch.maybeStopStoreWatch,
        refreshWsConnection: wsRuntime.refreshWsConnection,
        disconnectWs: () => wsRuntime.wsClient.disconnect()
    });
}
