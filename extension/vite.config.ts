import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { resolve } from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";
import owlXmlPlugin from "./vite-plugin-owl-xml";

export default defineConfig(({ mode }) => {
    const target = process.env.TARGET || "chrome";
    const outDir = `extension/dist/${target}`;
    const manifestSrc =
        target === "firefox" ? "extension/manifest.firefox.json" : "extension/manifest.json";
    const manifestPath = resolve(__dirname, "..", manifestSrc);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string };

    return {
        resolve: {
            alias: {
                "@extension": resolve(__dirname, "..", "extension")
            }
        },
        define: {
            __EXTENSION_VERSION__: JSON.stringify(manifest.version),
            __BROWSER_TARGET__: JSON.stringify(target)
        },
        build: {
            outDir,
            emptyOutDir: true,
            rollupOptions: {
                input: {
                    service_worker: resolve(__dirname, "src/service_worker.ts"),
                    main: resolve(__dirname, "src/popup/main.ts"),
                    content_bundle: resolve(__dirname, "src/content.ts"),
                    page_bridge: resolve(__dirname, "src/page_bridge.ts")
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
                        src: "extension/popup.html",
                        dest: "."
                    }
                ]
            })
        ],
        root: "."
    };
});
