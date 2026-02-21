import { Plugin } from "vite";
import { compileTemplates } from "@odoo/owl/dist/compile_templates.mjs";

export default function owlXmlPlugin(): Plugin {
    return {
        name: "owl-xml-transform",
        async transform(code, id) {
            if (!id.endsWith(".xml")) {
                return;
            }

            try {
                const compiled = await compileTemplates([id]);
                return {
                    code: compiled,
                    map: null
                };
            } catch (e) {
                console.error("Failed to compile template:", e);
                throw e;
            }
        }
    };
}
