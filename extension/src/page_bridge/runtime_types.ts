export enum PttCommand {
    PttDown = "ptt-down",
    PttUp = "ptt-up",
    ToggleVoice = "toggle-voice"
}

const PTT_COMMANDS = new Set<string>(Object.values(PttCommand));

export function isPttCommand(value: unknown): value is PttCommand {
    return typeof value === "string" && PTT_COMMANDS.has(value);
}

export type RtcSession = {
    localId?: string;
    id?: number;
    isTalking: boolean;
    isMute: boolean;
    is_deaf: boolean;
    is_camera_on: boolean;
    is_screen_sharing_on: boolean;
};

export type RtcChannel = {
    id: number;
    name: string;
    open: () => void;
};

export type RtcService = {
    localSession?: RtcSession;
    channel?: RtcChannel;
    pipService?: unknown;
    pttExtService?: {
        voiceActivated?: boolean;
    };
    setTalking?: (isTalking: boolean) => Promise<void> | void;
    onPushToTalk: () => void;
    setPttReleaseTimeout: (duration?: number) => void;
    toggleMicrophone: () => Promise<void> | void;
    toggleDeafen: () => Promise<void> | void;
    toggleVideo: (type: "camera" | "screen") => Promise<void> | void;
    openPip: (options: Record<string, unknown>) => Promise<void> | void;
    leaveCall: () => Promise<void> | void;
};

export type MailStore = {
    rtc?: RtcService;
    onChange: (target: object, key: string | string[], cb: () => void) => (() => void) | void;
};

export type OdooWindow = Window & {
    odoo?: {
        __WOWL_DEBUG__?: {
            root: {
                env: {
                    services: {
                        "mail.store"?: MailStore;
                    };
                };
            };
        };
    };
};
