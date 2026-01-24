import { defineConfig } from "vite";
import { resolve } from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
    build: {
        outDir: "extension/dist",
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
                    src: "extension/manifest.json",
                    dest: "."
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
});
