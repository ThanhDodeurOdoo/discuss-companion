import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const appRoot = __dirname;
const repositoryRoot = resolve(appRoot, "..");
const host = process.env.TAURI_DEV_HOST;
const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf-8"));

export default defineConfig(async () => ({
    root: appRoot,
    clearScreen: false,
    resolve: {
        alias: {
            "@root": repositoryRoot
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
            ignored: ["**/backend/**"]
        }
    }
}));
