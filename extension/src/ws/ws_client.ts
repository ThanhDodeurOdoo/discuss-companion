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
            reconnectTimeoutId = null;
        }
    }

    function scheduleReconnect() {
        const url = lastUrl;
        if (!shouldReconnect || reconnectTimeoutId !== null || !url) {
            return;
        }
        reconnectTimeoutId = window.setTimeout(() => {
            reconnectTimeoutId = null;
            connect(url);
        }, reconnectDelayMs);
    }

    function connect(url: string) {
        lastUrl = url;
        shouldReconnect = true;
        if (
            socket &&
            (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
        ) {
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

        socket.onopen = () => {
            options.log("[BG] WS Open");
            options.onConnectionChange(true);
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
            try {
                const data = new Uint8Array(event.data as ArrayBuffer);
                options.onMessage(data);
            } catch (error) {
                options.log("[BG] WS Message decode failed", error);
            }
        };

        socket.onerror = (error) => {
            options.log("[BG] WS Error", error);
            options.onConnectionChange(false);
        };

        socket.onclose = (event) => {
            options.log("[BG] WS Close", event);
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
