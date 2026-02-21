import { defineConfig } from "vite";
import { readFileSync } from "fs";
import { resolve } from "path";

const host = process.env.TAURI_DEV_HOST;
const packageJson = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));

export default defineConfig(async () => ({
    clearScreen: false,
    resolve: {
        alias: {
            "@root": resolve(__dirname)
        }
    },
    define: {
        __APP_VERSION__: JSON.stringify(packageJson.version)
    },
    optimizeDeps: {
        entries: ["index.html"]
    },
    server: {
        port: 1420,
        strictPort: true,
        host: host || false,
        hmr: host
            ? {
                  protocol: "ws",
                  host,
                  port: 1421
              }
            : undefined,
        watch: {
            ignored: ["**/app/backend/**"]
        }
    }
}));
