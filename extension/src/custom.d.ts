declare module "*.xml" {
    import { Template } from "@odoo/owl";
    export const templates: Record<string, Template>;
}

declare module "*/compile_templates.mjs" {
    export function compileTemplates(paths: string[]): Promise<string>;
}

interface Window {
    odoo?: {
        info?: {
            server_version?: string;
        };
        __WOWL_DEBUG__?: {
            root: {
                env: {
                    services: {
                        "mail.store": {
                            rtc: object;
                        };
                    };
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
