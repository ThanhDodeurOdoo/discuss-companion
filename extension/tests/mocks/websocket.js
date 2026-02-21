import { jest } from "@jest/globals";

/**
 * A WebSocket mock that fails a configurable number of times before succeeding.
 */
export class FailSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static DEFAULT_OPEN_ON_ATTEMPT = 3;
    static DEFAULT_OPEN_DELAY_MS = 1;
    static openOnAttempt = FailSocket.DEFAULT_OPEN_ON_ATTEMPT;
    static openDelayMs = FailSocket.DEFAULT_OPEN_DELAY_MS;
    static attempts = 0;

    static configure({
        openOnAttempt = FailSocket.DEFAULT_OPEN_ON_ATTEMPT,
        openDelayMs = FailSocket.DEFAULT_OPEN_DELAY_MS
    } = {}) {
        FailSocket.openOnAttempt = openOnAttempt;
        FailSocket.openDelayMs = openDelayMs;
    }

    static reset() {
        FailSocket.attempts = 0;
        FailSocket.openOnAttempt = FailSocket.DEFAULT_OPEN_ON_ATTEMPT;
        FailSocket.openDelayMs = FailSocket.DEFAULT_OPEN_DELAY_MS;
    }

    constructor(url) {
        this.url = url;
        this.readyState = FailSocket.CONNECTING;
        FailSocket.attempts += 1;
        if (FailSocket.attempts < FailSocket.openOnAttempt) {
            throw new Error("Connection failed");
        }
        setTimeout(() => {
            this.readyState = FailSocket.OPEN;
            this.onopen?.();
        }, FailSocket.openDelayMs);
    }

    url;
    readyState;
    binaryType = "blob";
    send = jest.fn();
    close = jest.fn();
    onopen;
    onmessage;
    onerror;
    onclose;
}
