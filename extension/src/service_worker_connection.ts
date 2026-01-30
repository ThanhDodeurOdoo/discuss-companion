import * as flatbuffers from "flatbuffers";
import { Message } from "./discuss/ws-protocol/message";
import { MessageBody } from "./discuss/ws-protocol/message-body";
import { Ping } from "./discuss/ws-protocol/ping";
import { Status } from "./discuss/ws-protocol/status";

const RECONNECT_ALARM_NAME = "reconnect_alarm";

type ConnectionHandlers = {
    log: (...args: unknown[]) => void;
    onPttPressed: () => void;
    onPttReleased: () => void;
    onStatusState: (state?: string | null) => void;
    onConnectionStateChange: () => void;
    onLoggingChange: (isEnabled: boolean) => void;
};

export type ConnectionManager = {
    init: () => void;
    handleAlarm: (alarm: chrome.alarms.Alarm) => void;
    isConnected: () => boolean;
};

export function createConnectionManager(handlers: ConnectionHandlers): ConnectionManager {
    let socket: WebSocket | null = null;
    let wsPort = 49152;
    let isCompanionEnabled = false;

    const isConnected = () => socket?.readyState === WebSocket.OPEN;

    function connectToApp() {
        if (!isCompanionEnabled) {
            return;
        }
        if (
            socket &&
            (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
        ) {
            return;
        }

        const wsUrl = `ws://127.0.0.1:${wsPort}`;
        try {
            handlers.log("[BG] Connecting to WS", wsUrl);
            socket = new WebSocket(wsUrl);
            socket.binaryType = "arraybuffer";
        } catch (e) {
            handlers.log("[BG] WebSocket creation failed", e);
            return;
        }

        let pingInterval: ReturnType<typeof setInterval>;

        socket.onopen = () => {
            handlers.log("[BG] WS Open");
            chrome.alarms.clear(RECONNECT_ALARM_NAME);
            handlers.onConnectionStateChange();

            sendPing();

            pingInterval = setInterval(() => {
                if (socket?.readyState === WebSocket.OPEN) {
                    sendPing();
                }
            }, 30000);
        };

        socket.onmessage = (event) => {
            try {
                const data = new Uint8Array(event.data);
                const buf = new flatbuffers.ByteBuffer(data);
                const message = Message.getRootAsMessage(buf);

                handlers.log("[BG] WS Message bodyType:", message.bodyType());
                switch (message.bodyType()) {
                    case MessageBody.PttDown:
                        handlers.onPttPressed();
                        break;
                    case MessageBody.PttUp:
                        handlers.onPttReleased();
                        break;
                    case MessageBody.Status:
                        {
                            const status = message.body(new Status()) as Status | null;
                            handlers.onStatusState(status?.state());
                        }
                        break;
                    case MessageBody.Pong:
                        break;
                    default:
                        break;
                }
            } catch {
                // skip
            }
        };

        socket.onclose = (e) => {
            handlers.log("[BG] WS Close", e);
            if (pingInterval) {
                clearInterval(pingInterval);
            }
            socket = null;
            handlers.onConnectionStateChange();
            if (isCompanionEnabled) {
                chrome.alarms.create(RECONNECT_ALARM_NAME, { delayInMinutes: 0.1 });
            } else {
                chrome.alarms.clear(RECONNECT_ALARM_NAME);
            }
        };

        socket.onerror = (error) => {
            console.error("[BG] WS Error", error);
            handlers.onConnectionStateChange();
        };
    }

    function sendPing() {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            handlers.onConnectionStateChange();
            return;
        }

        const builder = new flatbuffers.Builder(64);
        Ping.startPing(builder);
        const pingOffset = Ping.endPing(builder);

        Message.startMessage(builder);
        Message.addBodyType(builder, MessageBody.Ping);
        Message.addBody(builder, pingOffset);
        const messageOffset = Message.endMessage(builder);
        builder.finish(messageOffset);

        socket.send(builder.asUint8Array());
    }

    function init() {
        chrome.storage.local.get(
            { wsPort: 49152, isLoggingEnabled: false, isCompanionEnabled: false },
            (items) => {
                wsPort = items.wsPort as number;
                handlers.onLoggingChange(Boolean(items.isLoggingEnabled));
                isCompanionEnabled = Boolean(items.isCompanionEnabled);
                if (isCompanionEnabled) {
                    connectToApp();
                } else {
                    handlers.onConnectionStateChange();
                }
            }
        );

        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === "local") {
                if (changes.wsPort) {
                    const newPort = changes.wsPort.newValue as number;
                    wsPort = newPort;
                    if (socket) {
                        socket.close();
                    } else {
                        connectToApp();
                    }
                }
                if (changes.isLoggingEnabled) {
                    handlers.onLoggingChange(Boolean(changes.isLoggingEnabled.newValue));
                }
                if (changes.isCompanionEnabled) {
                    isCompanionEnabled = Boolean(changes.isCompanionEnabled.newValue);
                    if (!isCompanionEnabled) {
                        chrome.alarms.clear(RECONNECT_ALARM_NAME);
                        if (socket) {
                            socket.close();
                        } else {
                            handlers.onConnectionStateChange();
                        }
                    } else {
                        connectToApp();
                    }
                }
            }
        });
    }

    function handleAlarm(alarm: chrome.alarms.Alarm) {
        if (alarm.name === RECONNECT_ALARM_NAME) {
            connectToApp();
        }
    }

    return {
        init,
        handleAlarm,
        isConnected
    };
}
