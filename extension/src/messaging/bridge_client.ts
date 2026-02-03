import {
    type BridgeEventType,
    type BridgeRequestType,
    createBridgeRequest,
    isBridgeEvent,
    isBridgeResponse,
    nextBridgeRequestId
} from "./bridge_protocol";

export type BridgeClient = {
    request: <T = unknown>(
        type: BridgeRequestType,
        payload?: unknown,
        timeoutMs?: number
    ) => Promise<T | null>;
    onEvent: (type: BridgeEventType, handler: (payload: unknown) => void) => void;
};

type PendingRequest = {
    resolve: (value: unknown) => void;
    timeoutId: number;
};

export function createBridgeClient(origin: string = location.origin): BridgeClient {
    const pending = new Map<string, PendingRequest>();
    const eventHandlers = new Map<BridgeEventType, Set<(payload: unknown) => void>>();

    function handleMessage(event: MessageEvent) {
        if (event.source !== window || event.origin !== origin) {
            return;
        }
        const data = event.data;
        if (isBridgeResponse(data)) {
            const entry = pending.get(data.requestId);
            if (!entry) {
                return;
            }
            window.clearTimeout(entry.timeoutId);
            pending.delete(data.requestId);
            entry.resolve(data.ok ? data.payload : null);
            return;
        }
        if (isBridgeEvent(data)) {
            const handlers = eventHandlers.get(data.type);
            if (!handlers) {
                return;
            }
            for (const handler of handlers) {
                handler(data.payload);
            }
        }
    }

    window.addEventListener("message", handleMessage);

    function request<T = unknown>(type: BridgeRequestType, payload?: unknown, timeoutMs = 3000) {
        const requestId = nextBridgeRequestId();
        const message = createBridgeRequest(requestId, type, payload);
        const promise = new Promise<T | null>((resolve) => {
            const timeoutId = window.setTimeout(() => {
                pending.delete(requestId);
                resolve(null);
            }, timeoutMs);
            pending.set(requestId, {
                resolve: (value) => resolve(value as T | null),
                timeoutId
            });
        });
        window.postMessage(message, origin);
        return promise;
    }

    function onEvent(type: BridgeEventType, handler: (payload: unknown) => void) {
        const handlers = eventHandlers.get(type) ?? new Set();
        handlers.add(handler);
        eventHandlers.set(type, handlers);
    }

    return { request, onEvent };
}
