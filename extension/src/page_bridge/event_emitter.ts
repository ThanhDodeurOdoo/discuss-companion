import type { CallState } from "@extension/src/call_state_types";
import {
    BRIDGE_CHANNEL,
    BridgeEventType,
    type BridgeEvent
} from "@extension/src/messaging/bridge_protocol";
import type { PageBridgeRuntimeState } from "@extension/src/page_bridge/runtime_state";

export function createBridgeEventEmitter(state: PageBridgeRuntimeState) {
    function emitBridgeEvent(type: BridgeEvent["type"], payload: unknown): void {
        const event: BridgeEvent = {
            channel: BRIDGE_CHANNEL,
            kind: "event",
            type,
            payload
        };
        window.postMessage(event, location.origin);
    }

    function emitLifecycle(payload: {
        hasRtcService: boolean;
        hasHostedCall: boolean;
        isTalking: boolean;
    }): void {
        const signature = JSON.stringify(payload);
        if (signature === state.lastLifecycleSignature) {
            return;
        }
        state.lastLifecycleSignature = signature;
        emitBridgeEvent(BridgeEventType.CallLifecycleUpdate, payload);
    }

    function emitCallState(stateValue: CallState | null): void {
        const payload = stateValue ? { hasState: true, state: stateValue } : { hasState: false };
        const signature = JSON.stringify(payload);
        if (signature === state.lastCallStateSignature) {
            return;
        }
        state.lastCallStateSignature = signature;
        emitBridgeEvent(BridgeEventType.CallStateUpdate, payload);
    }

    return {
        emitLifecycle,
        emitCallState
    };
}
