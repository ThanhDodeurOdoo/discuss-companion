import type { CallState } from "../call_state_types";
import { BRIDGE_CHANNEL, type BridgeEvent } from "../messaging/bridge_protocol";
import type { PageBridgeRuntimeState } from "./runtime_state";

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
        emitBridgeEvent("call-lifecycle-update", payload);
    }

    function emitCallState(stateValue: CallState | null): void {
        const payload = stateValue ? { hasState: true, state: stateValue } : { hasState: false };
        const signature = JSON.stringify(payload);
        if (signature === state.lastCallStateSignature) {
            return;
        }
        state.lastCallStateSignature = signature;
        emitBridgeEvent("call-state-update", payload);
    }

    return {
        emitLifecycle,
        emitCallState
    };
}
