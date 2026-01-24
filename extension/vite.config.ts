import { defineConfig } from "vite";
import { resolve } from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig(({ mode }) => {
    const target = process.env.TARGET || "chrome";
    const outDir = `extension/dist/${target}`;
    const manifestSrc =
        target === "firefox" ? "extension/manifest.firefox.json" : "extension/manifest.json";

    return {
        build: {
            outDir,
            emptyOutDir: true,
            lib: {
                entry: resolve(__dirname, "src/background.ts"),
                formats: ["es"],
                fileName: () => "background.js"
            },
            rollupOptions: {
                input: {
                    background: resolve(__dirname, "src/background.ts")
                },
                output: {
                    entryFileNames: "background.js"
                }
            }
        },
        plugins: [
            viteStaticCopy({
                targets: [
                    {
                        src: manifestSrc,
                        dest: ".",
                        rename: "manifest.json"
                    },
                    {
                        src: "extension/content.js",
                        dest: "."
                    },
                    {
                        src: "extension/assets",
                        dest: "."
                    }
                ]
            })
        ],
        root: "."
    };
});
