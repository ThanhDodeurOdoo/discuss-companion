import type { Plugin } from "vite";
import { compileTemplates } from "@odoo/owl/dist/compile_templates.mjs";

const XML_FILE_REGEX = /\.xml$/;

export default function owlXmlPlugin(): Plugin {
    return {
        name: "owl-xml-transform",
        transform: {
            filter: {
                id: XML_FILE_REGEX
            },
            async handler(code, id) {
                if (!XML_FILE_REGEX.test(id)) {
                    return;
                }

                try {
                    const compiled = await compileTemplates([id]);
                    return {
                        code: compiled,
                        map: null,
                        moduleType: "js"
                    };
                } catch (e) {
                    console.error("Failed to compile template:", e);
                    throw e;
                }
            }
        }
    };
}
