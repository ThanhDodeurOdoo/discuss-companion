import { createBridgeClient } from "../messaging/bridge_client";
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

export function startContentRuntime(): void {
    const state = createContentRuntimeState();
    const log = createLogger(state);
    const bridge = createBridgeClient();

    const bridgeWatch = createBridgeWatchRuntime(state, bridge, log);

    let sendCallStateToAppRef: (nextState?: CallState | null) => Promise<void> = async () => {};
    let handleWsMessageRef: (data: Uint8Array) => void = () => {};

    const wsRuntime = createContentWsRuntime({
        state,
        log,
        sendToServiceWorker,
        onMessage: (data) => handleWsMessageRef(data),
        onConnected: async () => {
            await sendCallStateToAppRef();
        }
    });

    const callStateSync = createCallStateSyncRuntime({
        state,
        bridge,
        wsClient: wsRuntime.wsClient,
        ensureBridgeReady: bridgeWatch.ensureBridgeReady,
        sendToServiceWorker
    });
    sendCallStateToAppRef = callStateSync.sendCallStateToApp;

    const callInfoCapture = createCallInfoCaptureController({
        state,
        ensureBridgeReady: bridgeWatch.ensureBridgeReady,
        bridge,
        log
    });

    const lifecycleSync = createLifecycleSyncRuntime({
        state,
        log,
        sendToServiceWorkerExpectOk: callStateSync.sendToServiceWorkerExpectOk,
        updateCachedCallState: callStateSync.updateCachedCallState,
        scheduleCallInfoCapture: callInfoCapture.scheduleCallInfoCapture,
        clearCallInfoCapture: callInfoCapture.clearCallInfoCapture,
        disconnectWs: () => wsRuntime.wsClient.disconnect()
    });

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

    bridge.onEvent("call-lifecycle-update", lifecycleSync.queueLifecycleUpdate);
    bridge.onEvent("call-state-update", callControls.handleBridgeCallStateEvent);

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
