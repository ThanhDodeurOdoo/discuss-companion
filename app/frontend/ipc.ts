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
import { CallCommand } from "./call_commands";
import {
    ChannelEventType,
    type ChannelEvent,
    IPC_COMMAND,
    type AppVisibilityMode
} from "./ipc_types";

// PTT

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

    await invoke(IPC_COMMAND.UpdateBinding, bytes);
}

export async function setRecordingMode(recording: boolean) {
    const builder = new Builder(1024);

    SetRecordingMode.startSetRecordingMode(builder);
    SetRecordingMode.addRecording(builder, recording);
    const offset = SetRecordingMode.endSetRecordingMode(builder);

    builder.finish(offset);
    const bytes = builder.asUint8Array();

    await invoke(IPC_COMMAND.SetRecordingMode, bytes);
}

export async function getCurrentBinding(): Promise<{ code: number; modifiers: number[] }> {
    return invoke(IPC_COMMAND.GetCurrentBinding);
}

export async function forcePttUp(): Promise<void> {
    await invoke(IPC_COMMAND.ForcePttUp);
}

// WS

export async function updateWsPort(port: number) {
    const builder = new Builder(1024);
    SetWsPort.startSetWsPort(builder);
    SetWsPort.addPort(builder, port);
    const offset = SetWsPort.endSetWsPort(builder);
    builder.finish(offset);
    const bytes = builder.asUint8Array();
    await invoke(IPC_COMMAND.UpdateWsPort, bytes);
}

export async function getWsPort(): Promise<number> {
    return invoke(IPC_COMMAND.GetWsPort);
}

// Features / App Settings

export async function getFeatures(): Promise<{ ptt: boolean; callControlsTray: boolean }> {
    return invoke(IPC_COMMAND.GetFeatures);
}

export async function getAppVisibilityMode(): Promise<AppVisibilityMode> {
    return invoke(IPC_COMMAND.GetAppVisibilityMode);
}

export async function setAppVisibilityMode(mode: AppVisibilityMode): Promise<void> {
    await invoke(IPC_COMMAND.SetAppVisibilityMode, { mode });
}

export async function isAccessibilityGranted(): Promise<boolean> {
    return invoke(IPC_COMMAND.IsAccessibilityGranted);
}

export async function isExtensionConnected(): Promise<boolean> {
    return invoke(IPC_COMMAND.IsExtensionConnected);
}

// Window

export async function showMainWindow(): Promise<void> {
    await invoke(IPC_COMMAND.ShowMainWindow);
}

export async function quitApp(): Promise<void> {
    await invoke(IPC_COMMAND.QuitApp);
}

// Call Commands

async function sendCallCommand(command: CallCommand, value?: boolean): Promise<boolean> {
    return invoke<boolean>(IPC_COMMAND.SendCallCommand, { command, value });
}

export async function setMute(value: boolean): Promise<boolean> {
    return sendCallCommand(CallCommand.SetMute, value);
}

export async function setDeaf(value: boolean): Promise<boolean> {
    return sendCallCommand(CallCommand.SetDeaf, value);
}

export async function setCamera(value: boolean): Promise<boolean> {
    return sendCallCommand(CallCommand.SetCamera, value);
}

export async function setScreen(value: boolean): Promise<boolean> {
    return sendCallCommand(CallCommand.SetScreen, value);
}

export async function openPip(): Promise<boolean> {
    return sendCallCommand(CallCommand.OpenPip);
}

export async function leaveCall(): Promise<boolean> {
    return sendCallCommand(CallCommand.LeaveCall);
}

export async function focusCallTab(): Promise<boolean> {
    return sendCallCommand(CallCommand.FocusCallTab);
}

// Channel

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

    await invoke(IPC_COMMAND.EstablishChannel, { channel });
}
