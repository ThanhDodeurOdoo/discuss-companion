declare module "*.xml" {
    import { Template } from "@odoo/owl";
    export const templates: Record<string, Template>;
}

declare module "*/compile_templates.mjs" {
    export function compileTemplates(paths: string[]): Promise<string>;
}

type Store = {
    rtc: {
        selfSession?: {
            isMute: boolean;
            is_deaf: boolean;
            is_camera_on: boolean;
            is_screen_sharing_on: boolean;
        };
        toggleDeafen(): Promise<void>;
        toggleMicrophone(): Promise<void>;
        toggleVideo(type: "camera" | "screen"): Promise<void>;
        leaveCall(): Promise<void>;
    };
};

interface Window {
    odoo?: {
        info?: {
            server_version?: string;
        };
        __WOWL_DEBUG__?: {
            root: {
                env: {
                    services: {
                        "mail.store": Store;
                    } & Record<string, unknown>;
                };
            };
        };
    };
    owl?: {
        __info__?: {
            version?: string;
        };
    };
}
