export type CallStatePayload = {
    hasCall: boolean;
    hasState: boolean;
    isMute: boolean;
    isDeaf: boolean;
    isCameraOn: boolean;
    isScreenOn: boolean;
};

export enum ChannelEventType {
    PttEvent = "ptt-event",
    WsConnection = "ws-connection",
    WsDisconnection = "ws-disconnection",
    Error = "error",
    WsMessage = "ws-message",
    CallState = "call-state"
}

export type ChannelEvent =
    | { type: ChannelEventType.PttEvent; payload: unknown }
    | { type: ChannelEventType.WsConnection }
    | { type: ChannelEventType.WsDisconnection }
    | { type: ChannelEventType.Error; payload: string }
    | { type: ChannelEventType.WsMessage; payload: unknown }
    | { type: ChannelEventType.CallState; payload: CallStatePayload };
