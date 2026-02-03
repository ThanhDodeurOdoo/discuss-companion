import { describe, test, expect } from "@jest/globals";
import {
    BRIDGE_CHANNEL,
    createBridgeRequest,
    isBridgeEvent,
    isBridgeResponse,
    nextBridgeRequestId
} from "../src/messaging/bridge_protocol.ts";

describe("bridge_protocol", () => {
    test("creates bridge requests with channel and kind", () => {
        const requestId = nextBridgeRequestId();
        const request = createBridgeRequest(requestId, "read-call-state");
        expect(request.channel).toBe(BRIDGE_CHANNEL);
        expect(request.kind).toBe("request");
        expect(request.requestId).toBe(requestId);
    });

    test("detects bridge responses and events", () => {
        const response = {
            channel: BRIDGE_CHANNEL,
            kind: "response",
            requestId: "bridge-1",
            ok: true
        };
        const event = {
            channel: BRIDGE_CHANNEL,
            kind: "event",
            type: "call-state-update"
        };
        expect(isBridgeResponse(response)).toBe(true);
        expect(isBridgeEvent(event)).toBe(true);
    });
});
