import type { CallState } from "./call_state_types";

export type CallStateObserverPayload = {
    hasState: boolean;
    state?: CallState;
};

export function isCallStateObserverPayload(value: unknown): value is CallStateObserverPayload {
    if (!value || typeof value !== "object") {
        return false;
    }
    const payload = value as {
        hasState?: unknown;
        state?: unknown;
    };
    if (typeof payload.hasState !== "boolean") {
        return false;
    }
    if (!payload.hasState) {
        return true;
    }
    if (!payload.state || typeof payload.state !== "object") {
        return false;
    }
    const state = payload.state as Partial<CallState>;
    return (
        typeof state.isMute === "boolean" &&
        typeof state.isDeaf === "boolean" &&
        typeof state.isCameraOn === "boolean" &&
        typeof state.isScreenOn === "boolean"
    );
}
