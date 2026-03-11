import { Builder, ByteBuffer } from "flatbuffers";
import { invoke, Channel } from "@tauri-apps/api/core";
import {
    PttBinding,
    SetRecordingMode,
    SetWsPort,
    ToFrontendMessage,
    ToFrontend,
    PttState,
    CallState,
    WsConnection,
    BackendError,
    WsMessageEvent,
    IncomingMessageUnion,
    ConnectionStatus
} from "./flatbuffers/discuss/ipc-protocol";
import type { CallCommand } from "./call_commands";
import { ChannelEventType, type ChannelEvent, type CallStatePayload } from "./ipc_types";

export { ChannelEventType, type ChannelEvent, type CallStatePayload };

export async function updateBinding(code: number, modifiers: number[]) {
    const builder = new Builder(1024);

    const translatedModifiers = modifiers.map((m) => {
        // Map frontend modifiers to flatbuffer modifiers (assuming same order/values or map explicitly)
        // Frontend uses: 0: Cmd, 1: Ctrl, 2: Option, 3: Shift (based on utils.ts MODIFIER_ORDER?)
        // Flatbuffer: Shift=0, Control=1, Alt=2, Meta=3
        return m;
    });

    const modifiersOffset = PttBinding.createModifiersVector(builder, translatedModifiers);

    PttBinding.startPttBinding(builder);
    PttBinding.addCode(builder, code);
    PttBinding.addModifiers(builder, modifiersOffset);
    const offset = PttBinding.endPttBinding(builder);

    builder.finish(offset);
    const bytes = builder.asUint8Array();

    await invoke("update_binding", bytes);
}

export async function setRecordingMode(recording: boolean) {
    const builder = new Builder(1024);

    SetRecordingMode.startSetRecordingMode(builder);
    SetRecordingMode.addRecording(builder, recording);
    const offset = SetRecordingMode.endSetRecordingMode(builder);

    builder.finish(offset);
    const bytes = builder.asUint8Array();

    await invoke("set_recording_mode", bytes);
}

export async function updateWsPort(port: number) {
    const builder = new Builder(1024);
    SetWsPort.startSetWsPort(builder);
    SetWsPort.addPort(builder, port);
    const offset = SetWsPort.endSetWsPort(builder);
    builder.finish(offset);
    const bytes = builder.asUint8Array();
    await invoke("update_ws_port", bytes);
}

export async function sendCallCommand(command: CallCommand, value?: boolean): Promise<boolean> {
    return invoke<boolean>("send_call_command", { command, value });
}

export async function setupChannel(onEvent: (event: ChannelEvent) => void) {
    const channel = new Channel<ArrayBuffer | number[]>();
    channel.onmessage = (message: ArrayBuffer | number[]) => {
        let bytes: Uint8Array;
        if (message instanceof ArrayBuffer) {
            bytes = new Uint8Array(message);
        } else if (Array.isArray(message)) {
            bytes = new Uint8Array(message);
        } else {
            console.error("Unknown message type on channel:", message);
            return;
        }

        const buf = new ByteBuffer(bytes);
        const msg = ToFrontendMessage.getRootAsToFrontendMessage(buf);
        const eventType = msg.eventType();

        switch (eventType) {
            case ToFrontend.PttState: {
                const state = msg.event(new PttState()) as PttState;
                onEvent({
                    type: ChannelEventType.PttEvent,
                    payload: {
                        type: state.isActive() ? "ptt_down" : "ptt_up",
                        ts: Date.now(),
                        key: {
                            code: state.code(),
                            modifiers: Array.from(state.modifiersArray() || [])
                        },
                        is_repeat: state.isRepeat()
                    }
                });
                break;
            }
            case ToFrontend.WsConnection: {
                const conn = msg.event(new WsConnection()) as WsConnection;
                const status = conn.status();
                if (status === ConnectionStatus.Connected) {
                    onEvent({ type: ChannelEventType.WsConnection });
                } else {
                    onEvent({ type: ChannelEventType.WsDisconnection });
                }
                break;
            }
            case ToFrontend.BackendError: {
                const err = msg.event(new BackendError()) as BackendError;
                onEvent({
                    type: ChannelEventType.Error,
                    payload: err.message() || "Unknown backend error"
                });
                break;
            }
            case ToFrontend.CallState: {
                const state = msg.event(new CallState()) as CallState;
                onEvent({
                    type: ChannelEventType.CallState,
                    payload: {
                        hasCall: state.hasCall(),
                        hasState: state.hasState(),
                        isMute: state.isMute(),
                        isDeaf: state.isDeaf(),
                        isCameraOn: state.isCameraOn(),
                        isScreenOn: state.isScreenOn()
                    }
                });
                break;
            }
            case ToFrontend.WsMessageEvent: {
                const wsEvent = msg.event(new WsMessageEvent()) as WsMessageEvent;
                const msgType = wsEvent.messageType();

                switch (msgType) {
                    case IncomingMessageUnion.IncomingShutdown: {
                        onEvent({ type: ChannelEventType.WsMessage, payload: { Shutdown: {} } });
                        break;
                    }
                }
                break;
            }
        }
    };

    await invoke("establish_channel", { channel });
}
