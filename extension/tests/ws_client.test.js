import { describe, test, expect, jest } from "@jest/globals";
import { mockWebSocket, flushPromises } from "./utils.js";
import { FailSocket } from "./mocks/websocket.js";
import { createWsClient } from "../src/ws/ws_client.ts";

describe("ws_client", () => {
    test("connects and sends ping", async () => {
        mockWebSocket();
        const onConnectionChange = jest.fn();
        const client = createWsClient({
            log: jest.fn(),
            buildPingPayload: () => new Uint8Array([1, 2, 3]),
            onMessage: jest.fn(),
            onConnectionChange
        });

        client.connect("ws://127.0.0.1:1234");
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(global.mockSockets.length).toBe(1);
        const socket = global.mockSockets[0];
        expect(onConnectionChange).toHaveBeenCalledWith(true);
        expect(socket.send).toHaveBeenCalled();

        client.disconnect();
        expect(onConnectionChange).toHaveBeenCalledWith(false);
    });

    test("retries connection until websocket is established", async () => {
        jest.useFakeTimers();
        const originalWebSocket = global.WebSocket;

        FailSocket.configure({
            openOnAttempt: 3,
            openDelayMs: 1
        });

        try {
            global.WebSocket = FailSocket;
            const onConnectionChange = jest.fn();
            const client = createWsClient({
                log: jest.fn(),
                buildPingPayload: () => new Uint8Array([1, 2, 3]),
                onMessage: jest.fn(),
                onConnectionChange,
                reconnectDelayMs: 25
            });

            client.connect("ws://127.0.0.1:1234");
            expect(FailSocket.attempts).toBe(1);

            await jest.advanceTimersByTimeAsync(25);
            expect(FailSocket.attempts).toBe(2);

            await jest.advanceTimersByTimeAsync(25);
            await jest.advanceTimersByTimeAsync(1);
            expect(FailSocket.attempts).toBe(3);
            expect(onConnectionChange).toHaveBeenCalledWith(true);

            client.disconnect();
        } finally {
            global.WebSocket = originalWebSocket;
            FailSocket.reset();
            jest.useRealTimers();
        }
    });
});
