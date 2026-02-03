type CallActionDefinitionBase = {
    id: string;
    requiresUserGesture?: boolean;
    requiresFocusCallTab?: boolean;
    appCommands?: readonly string[];
};

type CallActionDefinition =
    | (CallActionDefinitionBase & {
          requiresValue: true;
      })
    | (CallActionDefinitionBase & {
          requiresValue: false;
      });

const defineCallActions = <T extends Record<string, CallActionDefinition>>(actions: T) => actions;

export const CALL_ACTION_DEFINITIONS = defineCallActions({
    ToggleMicrophone: {
        id: "toggle-microphone",
        requiresValue: false,
        requiresUserGesture: false
    },
    ToggleDeafen: {
        id: "toggle-deafen",
        requiresValue: false,
        requiresUserGesture: false
    },
    ToggleCamera: {
        id: "toggle-camera",
        requiresValue: false,
        requiresUserGesture: false
    },
    ToggleScreen: {
        id: "toggle-screen",
        requiresValue: false,
        requiresUserGesture: false,
        requiresFocusCallTab: true
    },
    OpenPip: {
        id: "open-pip",
        requiresValue: false,
        requiresUserGesture: true
    },
    LeaveCall: {
        id: "leave-call",
        requiresValue: false,
        requiresUserGesture: false
    },
    OpenChannel: {
        id: "open-channel",
        requiresValue: false,
        requiresUserGesture: false
    },
    SetMute: {
        id: "set-mute",
        requiresValue: true,
        requiresUserGesture: false,
        appCommands: ["update-mute"]
    },
    SetDeaf: {
        id: "set-deaf",
        requiresValue: true,
        requiresUserGesture: false,
        appCommands: ["update-deaf"]
    },
    SetCamera: {
        id: "set-camera",
        requiresValue: true,
        requiresUserGesture: false,
        appCommands: ["update-camera"]
    },
    SetScreen: {
        id: "set-screen",
        requiresValue: true,
        requiresUserGesture: false,
        requiresFocusCallTab: true,
        appCommands: ["update-screen"]
    }
} as const);

export type { CallActionDefinition };
