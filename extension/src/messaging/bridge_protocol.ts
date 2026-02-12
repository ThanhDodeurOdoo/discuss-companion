export const BRIDGE_CHANNEL = "discuss-companion-bridge" as const;

export type BridgeRequestType =
    | "call-action"
    | "read-call-state"
    | "get-call-info"
    | "start-store-watch"
    | "stop-store-watch"
    | "ptt-command";

export type BridgeEventType = "call-state-update" | "call-lifecycle-update";

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
    const event = value as BridgeEvent;
    return event.kind === "event" && typeof event.type === "string";
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
