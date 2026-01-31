type CallActionDefinitionBase = {
    id: string;
    requiresUserGesture?: boolean;
    requiresFocusCallTab?: boolean;
    appCommands?: readonly string[];
};

type CallActionDefinition =
    | (CallActionDefinitionBase & {
          requiresValue: true;
          run: (value: boolean) => Promise<boolean> | boolean;
      })
    | (CallActionDefinitionBase & {
          requiresValue: false;
          run: (value?: boolean) => Promise<boolean> | boolean;
      });

type CallActionRegistry = Record<string, CallActionDefinition>;

const defineCallActions = <T extends CallActionRegistry>(actions: T) => actions;

export function openChannelInTab() {
    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    if (!store?.rtc?.channel) {
        return false;
    }
    store.rtc.channel.open();
    return true;
}

async function toggleMicrophoneInTab() {
    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    if (!store?.rtc?.selfSession) {
        return false;
    }
    await store.rtc.toggleMicrophone();
    return true;
}

async function toggleDeafenInTab() {
    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    if (!store?.rtc?.selfSession) {
        return false;
    }
    await store.rtc.toggleDeafen();
    return true;
}

async function toggleCameraInTab() {
    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    if (!store?.rtc?.selfSession) {
        return false;
    }
    await store.rtc.toggleVideo("camera");
    return true;
}

async function toggleScreenInTab() {
    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    if (!store?.rtc?.selfSession) {
        return false;
    }
    await store.rtc.toggleVideo("screen");
    return true;
}

async function openPipInTab() {
    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    if (!store?.rtc?.pipService) {
        return false;
    }
    await store.rtc.openPip({});
    return true;
}

async function leaveCallInTab() {
    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    if (!store?.rtc?.leaveCall) {
        return false;
    }
    await store.rtc.leaveCall();
    return true;
}

async function setMuteInTab(value: boolean) {
    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    const selfSession = store?.rtc?.selfSession;
    if (!selfSession) {
        return false;
    }
    if (selfSession.isMute !== value) {
        await store.rtc.toggleMicrophone();
    }
    return true;
}

async function setDeafInTab(value: boolean) {
    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    const selfSession = store?.rtc?.selfSession;
    if (!selfSession) {
        return false;
    }
    if (selfSession.is_deaf !== value) {
        await store.rtc.toggleDeafen();
    }
    return true;
}

async function setCameraInTab(value: boolean) {
    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    const selfSession = store?.rtc?.selfSession;
    if (!selfSession) {
        return false;
    }
    if (selfSession.is_camera_on !== value) {
        await store.rtc.toggleVideo("camera");
    }
    return true;
}

async function setScreenInTab(value: boolean) {
    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    const selfSession = store?.rtc?.selfSession;
    if (!selfSession) {
        return false;
    }
    if (selfSession.is_screen_sharing_on !== value) {
        await store.rtc.toggleVideo("screen");
    }
    return true;
}

export const CALL_ACTIONS = defineCallActions({
    // Action definitions:
    // - id: stable external name (also used as WS/app command unless overridden).
    // - requiresValue: if true, action payloads must include a boolean value.
    // - requiresUserGesture: true when browser gesture is required (ex: PiP).
    // - run: executed inside the call tab.
    // - appCommands: optional extra WS/app command aliases for this action.
    ToggleMicrophone: {
        id: "toggle-microphone",
        requiresValue: false,
        requiresUserGesture: false,
        run: toggleMicrophoneInTab
    },
    ToggleDeafen: {
        id: "toggle-deafen",
        requiresValue: false,
        requiresUserGesture: false,
        run: toggleDeafenInTab
    },
    ToggleCamera: {
        id: "toggle-camera",
        requiresValue: false,
        requiresUserGesture: false,
        run: toggleCameraInTab
    },
    ToggleScreen: {
        id: "toggle-screen",
        requiresValue: false,
        requiresUserGesture: false,
        requiresFocusCallTab: true,
        run: toggleScreenInTab
    },
    OpenPip: {
        id: "open-pip",
        requiresValue: false,
        requiresUserGesture: true,
        run: openPipInTab
    },
    LeaveCall: {
        id: "leave-call",
        requiresValue: false,
        requiresUserGesture: false,
        run: leaveCallInTab
    },
    OpenChannel: {
        id: "open-channel",
        requiresValue: false,
        requiresUserGesture: false,
        run: openChannelInTab
    },
    SetMute: {
        id: "set-mute",
        requiresValue: true,
        requiresUserGesture: false,
        run: setMuteInTab,
        appCommands: ["update-mute"]
    },
    SetDeaf: {
        id: "set-deaf",
        requiresValue: true,
        requiresUserGesture: false,
        run: setDeafInTab,
        appCommands: ["update-deaf"]
    },
    SetCamera: {
        id: "set-camera",
        requiresValue: true,
        requiresUserGesture: false,
        run: setCameraInTab,
        appCommands: ["update-camera"]
    },
    SetScreen: {
        id: "set-screen",
        requiresValue: true,
        requiresUserGesture: false,
        requiresFocusCallTab: true,
        run: setScreenInTab,
        appCommands: ["update-screen"]
    }
} as const);

export type { CallActionDefinition };
