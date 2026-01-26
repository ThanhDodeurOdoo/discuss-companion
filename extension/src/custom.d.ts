declare module "*.xml" {
    import { Template } from "@odoo/owl";
    export const templates: Record<string, Template>;
}

declare module "*/compile_templates.mjs" {
    export function compileTemplates(paths: string[]): Promise<string>;
}
