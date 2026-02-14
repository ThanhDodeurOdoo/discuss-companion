export const BRIDGE_CHANNEL = "discuss-companion-bridge" as const;

export enum BridgeRequestType {
    CallAction = "call-action",
    ReadCallState = "read-call-state",
    GetCallInfo = "get-call-info",
    StartStoreWatch = "start-store-watch",
    StopStoreWatch = "stop-store-watch",
    PttCommand = "ptt-command"
}

export enum BridgeEventType {
    CallStateUpdate = "call-state-update",
    CallLifecycleUpdate = "call-lifecycle-update"
}

export type BridgeRequest = {
    channel: typeof BRIDGE_CHANNEL;
    kind: "request";
    requestId: string;
    type: BridgeRequestType;
    payload?: unknown;
};

export type BridgeResponse = {
    channel: typeof BRIDGE_CHANNEL;
    kind: "response";
    requestId: string;
    ok: boolean;
    payload?: unknown;
    error?: string;
};

export type BridgeEvent = {
    channel: typeof BRIDGE_CHANNEL;
    kind: "event";
    type: BridgeEventType;
    payload?: unknown;
};

export type BridgeMessage = BridgeRequest | BridgeResponse | BridgeEvent;

const BRIDGE_EVENT_TYPES = new Set<string>(Object.values(BridgeEventType));

export function isBridgeEventType(value: unknown): value is BridgeEventType {
    return typeof value === "string" && BRIDGE_EVENT_TYPES.has(value);
}

export function isBridgeMessage(value: unknown): value is BridgeMessage {
    if (!value || typeof value !== "object") {
        return false;
    }
    const message = value as { channel?: unknown; kind?: unknown };
    return message.channel === BRIDGE_CHANNEL && typeof message.kind === "string";
}

export function isBridgeResponse(value: unknown): value is BridgeResponse {
    if (!isBridgeMessage(value)) {
        return false;
    }
    const response = value as BridgeResponse;
    return response.kind === "response" && typeof response.requestId === "string";
}

export function isBridgeEvent(value: unknown): value is BridgeEvent {
    if (!isBridgeMessage(value)) {
        return false;
    }
    const event = value as { kind?: unknown; type?: unknown };
    return event.kind === "event" && isBridgeEventType(event.type);
}

export function createBridgeRequest(
    requestId: string,
    type: BridgeRequestType,
    payload?: unknown
): BridgeRequest {
    return {
        channel: BRIDGE_CHANNEL,
        kind: "request",
        requestId,
        type,
        payload
    };
}

let requestSequence = 0;

export function nextBridgeRequestId(): string {
    requestSequence += 1;
    return `bridge-${requestSequence}`;
}
