export const CallCommand = {
    ToggleMicrophone: "toggle-microphone",
    ToggleDeafen: "toggle-deafen",
    ToggleCamera: "toggle-camera",
    ToggleScreen: "toggle-screen",
    OpenPip: "open-pip",
    LeaveCall: "leave-call",
    OpenChannel: "open-channel",
    SetMute: "set-mute",
    SetDeaf: "set-deaf",
    SetCamera: "set-camera",
    SetScreen: "set-screen",
    FocusCallTab: "focus-call-tab",
    RefreshCallState: "refresh-call-state"
} as const;

export type CallCommand = (typeof CallCommand)[keyof typeof CallCommand];
