export type WsClient = {
    connect: (url: string, options?: WsClientConnectOptions) => void;
    disconnect: () => void;
    send: (data: Uint8Array) => boolean;
    isConnected: () => boolean;
};

export type WsClientConnectOptions = {
    resetAttemptLimit?: boolean;
};

export type WsClientRetryState = {
    isTrying: boolean;
    attemptsRemaining: number;
    maxAttempts: number;
};

type WsClientOptions = {
    log: (...args: unknown[]) => void;
    buildPingPayload: () => Uint8Array;
    onMessage: (data: Uint8Array) => void;
    onConnectionChange: (connected: boolean) => void;
    onRetryStateChange?: (state: WsClientRetryState) => void;
    pingIntervalMs?: number;
    reconnectDelayMs?: number;
    connectTimeoutMs?: number;
    maxConnectAttempts?: number;
};

const DEFAULT_PING_INTERVAL_MS = 30000;
const DEFAULT_RECONNECT_DELAY_MS = 1000;
const DEFAULT_CONNECT_TIMEOUT_MS = 1000;
const DEFAULT_MAX_CONNECT_ATTEMPTS = 60;

function formatSocketState(state?: number): string {
    switch (state) {
        case WebSocket.CONNECTING:
            return "connecting";
        case WebSocket.OPEN:
            return "open";
        case WebSocket.CLOSING:
            return "closing";
        case WebSocket.CLOSED:
            return "closed";
        default:
            return "unknown";
    }
}

export function createWsClient(options: WsClientOptions): WsClient {
    const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const maxConnectAttempts = options.maxConnectAttempts ?? DEFAULT_MAX_CONNECT_ATTEMPTS;

    let socket: WebSocket | null = null;
    let pingIntervalId: number | null = null;
    let reconnectTimeoutId: number | null = null;
    let connectTimeoutId: number | null = null;
    let lastUrl: string | null = null;
    let shouldReconnect = false;
    let attemptsRemaining = maxConnectAttempts;

    const isConnected = () => socket?.readyState === WebSocket.OPEN;

    function clearPing() {
        if (pingIntervalId !== null) {
            window.clearInterval(pingIntervalId);
            pingIntervalId = null;
        }
    }

    function clearReconnect() {
        if (reconnectTimeoutId !== null) {
            window.clearTimeout(reconnectTimeoutId);
            reconnectTimeoutId = null;
        }
    }

    function clearConnectTimeout() {
        if (connectTimeoutId !== null) {
            window.clearTimeout(connectTimeoutId);
            connectTimeoutId = null;
        }
    }

    function emitRetryState(isTrying: boolean) {
        options.onRetryStateChange?.({
            isTrying,
            attemptsRemaining,
            maxAttempts: maxConnectAttempts
        });
    }

    function resetAttemptLimit() {
        attemptsRemaining = maxConnectAttempts;
    }

    function hasAttemptBudget(): boolean {
        return attemptsRemaining > 0;
    }

    function stopReconnectAttempts() {
        shouldReconnect = false;
        clearReconnect();
        emitRetryState(false);
    }

    function consumeAttempt(): boolean {
        if (!hasAttemptBudget()) {
            stopReconnectAttempts();
            options.log("[BG] WS reconnect attempts exhausted", {
                maxAttempts: maxConnectAttempts
            });
            return false;
        }
        attemptsRemaining -= 1;
        emitRetryState(true);
        return true;
    }

    function scheduleConnectTimeout(activeSocket: WebSocket, url: string) {
        clearConnectTimeout();
        const timeoutId = window.setTimeout(() => {
            if (connectTimeoutId !== timeoutId) {
                return;
            }
            connectTimeoutId = null;
            if (socket !== activeSocket || activeSocket.readyState !== WebSocket.CONNECTING) {
                return;
            }
            options.log("[BG] WS connect timed out", { url, timeoutMs: connectTimeoutMs });
            socket = null;
            activeSocket.close();
            options.onConnectionChange(false);
            scheduleReconnect();
        }, connectTimeoutMs);
        connectTimeoutId = timeoutId;
    }

    function scheduleReconnect() {
        const url = lastUrl;
        if (!shouldReconnect || reconnectTimeoutId !== null || !url || !hasAttemptBudget()) {
            if (!hasAttemptBudget()) {
                stopReconnectAttempts();
            }
            return;
        }
        reconnectTimeoutId = window.setTimeout(() => {
            reconnectTimeoutId = null;
            connect(url);
        }, reconnectDelayMs);
    }

    function connect(url: string, connectOptions: WsClientConnectOptions = {}) {
        options.log("[BG] WS Connect requested", {
            url,
            socketState: formatSocketState(socket?.readyState),
            shouldReconnect
        });
        if (connectOptions.resetAttemptLimit) {
            resetAttemptLimit();
        }
        lastUrl = url;
        shouldReconnect = true;
        if (
            socket &&
            (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
        ) {
            return;
        }
        if (!consumeAttempt()) {
            options.onConnectionChange(false);
            return;
        }
        clearReconnect();
        try {
            options.log("[BG] Connecting to WS", url);
            socket = new WebSocket(url);
            socket.binaryType = "arraybuffer";
        } catch (error) {
            options.log("[BG] WebSocket creation failed", error);
            scheduleReconnect();
            return;
        }

        const activeSocket = socket;
        scheduleConnectTimeout(activeSocket, url);

        socket.onopen = () => {
            if (socket !== activeSocket) {
                activeSocket.close();
                return;
            }
            options.log("[BG] WS Open");
            options.onConnectionChange(true);
            resetAttemptLimit();
            emitRetryState(false);
            clearConnectTimeout();
            clearReconnect();
            clearPing();
            send(options.buildPingPayload());
            pingIntervalId = window.setInterval(() => {
                if (socket?.readyState === WebSocket.OPEN) {
                    send(options.buildPingPayload());
                }
            }, pingIntervalMs);
        };

        socket.onmessage = (event) => {
            if (socket !== activeSocket) {
                return;
            }
            try {
                const data = new Uint8Array(event.data as ArrayBuffer);
                options.onMessage(data);
            } catch (error) {
                options.log("[BG] WS Message decode failed", error);
            }
        };

        socket.onerror = (error) => {
            if (socket !== activeSocket) {
                return;
            }
            options.log("[BG] WS Error", error);
            options.onConnectionChange(false);
        };

        socket.onclose = (event) => {
            if (socket !== activeSocket) {
                return;
            }
            options.log("[BG] WS Close", event);
            clearConnectTimeout();
            clearPing();
            socket = null;
            options.onConnectionChange(false);
            scheduleReconnect();
        };
    }

    function disconnect() {
        shouldReconnect = false;
        clearReconnect();
        clearPing();
        clearConnectTimeout();
        emitRetryState(false);
        if (socket) {
            socket.close();
            socket = null;
        }
        options.onConnectionChange(false);
    }

    function send(data: Uint8Array): boolean {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            options.onConnectionChange(false);
            return false;
        }
        try {
            socket.send(data);
            return true;
        } catch (error) {
            options.log("[BG] WS send failed", error);
            options.onConnectionChange(false);
            return false;
        }
    }

    return {
        connect,
        disconnect,
        send,
        isConnected
    };
}
