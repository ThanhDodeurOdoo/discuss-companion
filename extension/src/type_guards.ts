import type { CallState } from "./call_state_types";
import { isPttCommand, type PttCommand } from "./page_bridge/runtime_types";

export type CallStateObserverPayload = {
    hasState: boolean;
    state?: CallState;
};

export type CallLifecycleObserverPayload = {
    hasRtcService: boolean;
    hasHostedCall: boolean;
    isTalking: boolean;
};

export type PttCommandPayload = {
    command: PttCommand;
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
        typeof state.isScreenOn === "boolean" &&
        typeof state.isVoiceActivated === "boolean"
    );
}

export function isCallLifecycleObserverPayload(
    value: unknown
): value is CallLifecycleObserverPayload {
    if (!value || typeof value !== "object") {
        return false;
    }
    const payload = value as {
        hasRtcService?: unknown;
        hasHostedCall?: unknown;
        isTalking?: unknown;
    };
    return (
        typeof payload.hasRtcService === "boolean" &&
        typeof payload.hasHostedCall === "boolean" &&
        typeof payload.isTalking === "boolean"
    );
}

export function isPttCommandPayload(value: unknown): value is PttCommandPayload {
    if (!value || typeof value !== "object") {
        return false;
    }
    const payload = value as { command?: unknown };
    return isPttCommand(payload.command);
}
