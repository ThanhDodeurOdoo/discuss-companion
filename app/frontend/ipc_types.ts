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
    | {
          type: ChannelEventType.PttEvent;
          payload: {
              type: string;
              ts: number;
              key: { code: number; modifiers: number[] };
              is_repeat: boolean;
          };
      }
    | { type: ChannelEventType.WsConnection }
    | { type: ChannelEventType.WsDisconnection }
    | { type: ChannelEventType.Error; payload: string }
    | { type: ChannelEventType.WsMessage; payload: unknown } // TODO maybe dead code cleanup later
    | { type: ChannelEventType.CallState; payload: CallStatePayload };

export const IPC_COMMAND = {
    SetRecordingMode: "set_recording_mode",
    UpdateBinding: "update_binding",
    GetCurrentBinding: "get_current_binding",
    ForcePttUp: "force_ptt_up",
    UpdateWsPort: "update_ws_port",
    GetWsPort: "get_ws_port",
    GetFeatures: "get_features",
    GetAppVisibilityMode: "get_app_visibility_mode",
    SetAppVisibilityMode: "set_app_visibility_mode",
    IsAccessibilityGranted: "is_accessibility_granted",
    IsExtensionConnected: "is_extension_connected",
    ShowMainWindow: "show_main_window",
    QuitApp: "quit_app",
    SendCallCommand: "send_call_command",
    EstablishChannel: "establish_channel"
} as const;

export const APP_VISIBILITY_MODE = {
    TrayAndDockWhenWindowOpen: "trayAndDockWhenWindowOpen",
    TrayAndDockAlways: "trayAndDockAlways",
    DockOnly: "dockOnly"
} as const;
export type AppVisibilityMode = (typeof APP_VISIBILITY_MODE)[keyof typeof APP_VISIBILITY_MODE];
