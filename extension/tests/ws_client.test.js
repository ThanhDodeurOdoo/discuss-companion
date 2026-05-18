import { describe, test, expect, jest } from "@jest/globals";
import { mockWebSocket, flushPromises } from "./utils.js";
import { FailSocket } from "./mocks/websocket.js";
import { createWsClient } from "../src/ws/ws_client.ts";

class HangingSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances = [];

    static reset() {
        HangingSocket.instances = [];
    }

    constructor(url) {
        this.url = url;
        this.readyState = HangingSocket.CONNECTING;
        HangingSocket.instances.push(this);
    }

    url;
    readyState;
    binaryType = "blob";
    send = jest.fn();
    close = jest.fn().mockImplementation(() => {
        this.readyState = HangingSocket.CLOSED;
    });
    onopen;
    onmessage;
    onerror;
    onclose;
}

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

    test("stops retrying when connection attempts are exhausted", async () => {
        jest.useFakeTimers();
        const originalWebSocket = global.WebSocket;

        FailSocket.configure({
            openOnAttempt: 100,
            openDelayMs: 1
        });

        try {
            global.WebSocket = FailSocket;
            const onRetryStateChange = jest.fn();
            const client = createWsClient({
                log: jest.fn(),
                buildPingPayload: () => new Uint8Array([1, 2, 3]),
                onMessage: jest.fn(),
                onConnectionChange: jest.fn(),
                onRetryStateChange,
                reconnectDelayMs: 25,
                maxConnectAttempts: 2
            });

            client.connect("ws://127.0.0.1:1234");
            expect(FailSocket.attempts).toBe(1);

            await jest.advanceTimersByTimeAsync(25);
            expect(FailSocket.attempts).toBe(2);

            await jest.advanceTimersByTimeAsync(25);
            expect(FailSocket.attempts).toBe(2);
            expect(onRetryStateChange).toHaveBeenLastCalledWith({
                isTrying: false,
                attemptsRemaining: 0,
                maxAttempts: 2
            });

            client.connect("ws://127.0.0.1:1234", { resetAttemptLimit: true });
            expect(FailSocket.attempts).toBe(3);
        } finally {
            global.WebSocket = originalWebSocket;
            FailSocket.reset();
            jest.useRealTimers();
        }
    });

    test("times out a stale connecting socket before retrying", async () => {
        jest.useFakeTimers();
        const originalWebSocket = global.WebSocket;

        try {
            global.WebSocket = HangingSocket;
            const onConnectionChange = jest.fn();
            const client = createWsClient({
                log: jest.fn(),
                buildPingPayload: () => new Uint8Array([1, 2, 3]),
                onMessage: jest.fn(),
                onConnectionChange,
                reconnectDelayMs: 25,
                connectTimeoutMs: 10
            });

            client.connect("ws://127.0.0.1:1234");
            expect(HangingSocket.instances).toHaveLength(1);

            await jest.advanceTimersByTimeAsync(10);
            expect(HangingSocket.instances[0].close).toHaveBeenCalledTimes(1);
            expect(onConnectionChange).toHaveBeenCalledWith(false);

            await jest.advanceTimersByTimeAsync(25);
            expect(HangingSocket.instances).toHaveLength(2);

            client.disconnect();
        } finally {
            global.WebSocket = originalWebSocket;
            HangingSocket.reset();
            jest.useRealTimers();
        }
    });
});
