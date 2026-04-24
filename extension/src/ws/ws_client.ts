export type WsClient = {
    connect: (url: string) => void;
    disconnect: () => void;
    send: (data: Uint8Array) => boolean;
    isConnected: () => boolean;
};

type WsClientOptions = {
    log: (...args: unknown[]) => void;
    buildPingPayload: () => Uint8Array;
    onMessage: (data: Uint8Array) => void;
    onConnectionChange: (connected: boolean) => void;
    pingIntervalMs?: number;
    reconnectDelayMs?: number;
};

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
    const pingIntervalMs = options.pingIntervalMs ?? 30000;
    const reconnectDelayMs = options.reconnectDelayMs ?? 6000;

    let socket: WebSocket | null = null;
    let pingIntervalId: number | null = null;
    let reconnectTimeoutId: number | null = null;
    let lastUrl: string | null = null;
    let shouldReconnect = false;

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
            options.log("[WS] Reconnect timer cleared");
            reconnectTimeoutId = null;
        }
    }

    function scheduleReconnect() {
        const url = lastUrl;
        if (!shouldReconnect || reconnectTimeoutId !== null || !url) {
            options.log("[WS] Reconnect skipped", {
                shouldReconnect,
                hasTimer: reconnectTimeoutId !== null,
                hasUrl: Boolean(url)
            });
            return;
        }
        options.log("[WS] Reconnect scheduled", { url, delayMs: reconnectDelayMs });
        reconnectTimeoutId = window.setTimeout(() => {
            reconnectTimeoutId = null;
            options.log("[WS] Reconnect timer fired", { url });
            connect(url);
        }, reconnectDelayMs);
    }

    function connect(url: string) {
        options.log("[WS] Connect requested", {
            url,
            socketState: formatSocketState(socket?.readyState),
            shouldReconnect
        });
        lastUrl = url;
        shouldReconnect = true;
        if (
            socket &&
            (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
        ) {
            options.log("[WS] Connect skipped because socket is already active", {
                url,
                socketState: formatSocketState(socket.readyState)
            });
            return;
        }
        clearReconnect();
        try {
            options.log("[WS] Opening socket", { url });
            socket = new WebSocket(url);
            socket.binaryType = "arraybuffer";
        } catch (error) {
            options.log("[WS] WebSocket creation failed", { url, error });
            scheduleReconnect();
            return;
        }

        socket.onopen = () => {
            options.log("[WS] Socket open", { url });
            options.onConnectionChange(true);
            clearReconnect();
            clearPing();
            options.log("[WS] Sending initial ping", { url });
            send(options.buildPingPayload());
            pingIntervalId = window.setInterval(() => {
                if (socket?.readyState === WebSocket.OPEN) {
                    options.log("[WS] Sending ping", { url });
                    send(options.buildPingPayload());
                    return;
                }
                options.log("[WS] Ping skipped because socket is not open", {
                    url,
                    socketState: formatSocketState(socket?.readyState)
                });
            }, pingIntervalMs);
        };

        socket.onmessage = (event) => {
            try {
                const data = new Uint8Array(event.data as ArrayBuffer);
                options.log("[WS] Message received", { url, bytes: data.byteLength });
                options.onMessage(data);
            } catch (error) {
                options.log("[WS] Message decode failed", { url, error });
            }
        };

        socket.onerror = (error) => {
            options.log("[WS] Socket error", {
                url,
                socketState: formatSocketState(socket?.readyState),
                error
            });
            options.onConnectionChange(false);
        };

        socket.onclose = (event) => {
            options.log("[WS] Socket close", {
                url,
                code: event.code,
                reason: event.reason,
                wasClean: event.wasClean
            });
            clearPing();
            socket = null;
            options.onConnectionChange(false);
            scheduleReconnect();
        };
    }

    function disconnect() {
        options.log("[WS] Disconnect requested", {
            socketState: formatSocketState(socket?.readyState),
            shouldReconnect
        });
        shouldReconnect = false;
        clearReconnect();
        clearPing();
        if (socket) {
            socket.close();
            socket = null;
        }
        options.onConnectionChange(false);
    }

    function send(data: Uint8Array): boolean {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            options.log("[WS] Send skipped because socket is not open", {
                socketState: formatSocketState(socket?.readyState),
                bytes: data.byteLength
            });
            options.onConnectionChange(false);
            return false;
        }
        try {
            socket.send(data);
            options.log("[WS] Message sent", { bytes: data.byteLength });
            return true;
        } catch (error) {
            options.log("[WS] Send failed", { bytes: data.byteLength, error });
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
