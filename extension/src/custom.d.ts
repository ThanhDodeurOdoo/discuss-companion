declare module "*.xml" {
    import { Template } from "@odoo/owl";
    export const templates: Record<string, Template>;
}

declare module "*/compile_templates.mjs" {
    export function compileTemplates(paths: string[]): Promise<string>;
}

declare const __EXTENSION_VERSION__: string;
declare const __BROWSER_TARGET__: string;

type Store = {
    rtc: {
        pipService?: object;
        selfSession?: {
            isMute: boolean;
            is_deaf: boolean;
            is_camera_on: boolean;
            is_screen_sharing_on: boolean;
        };
        channel?: {
            open: () => void;
        };
        openPip(options: object): Promise<void>;
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
