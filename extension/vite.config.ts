import { defineConfig } from "vite";
import { resolve } from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";
import owlXmlPlugin from "./vite-plugin-owl-xml";

export default defineConfig(({ mode }) => {
    const target = process.env.TARGET || "chrome";
    const outDir = `extension/dist/${target}`;
    const manifestSrc =
        target === "firefox" ? "extension/manifest.firefox.json" : "extension/manifest.json";

    return {
        build: {
            outDir,
            emptyOutDir: true,
            rollupOptions: {
                input: {
                    service_worker: resolve(__dirname, "src/service_worker.ts"),
                    main: resolve(__dirname, "src/popup/main.ts")
                },
                output: {
                    entryFileNames: "[name].js",
                    assetFileNames: "[name].[ext]"
                }
            }
        },
        plugins: [
            owlXmlPlugin(),
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
                        src: resolve(__dirname, "../assets/icons"),
                        dest: "assets"
                    },
                    {
                        src: resolve(__dirname, "../common/fonts"),
                        dest: "fonts"
                    },
                    {
                        src: "extension/options.html",
                        dest: "."
                    }
                ]
            })
        ],
        root: "."
    };
});
