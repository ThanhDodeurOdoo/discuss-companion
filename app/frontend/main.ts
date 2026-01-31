import { App as OwlApp } from "@odoo/owl";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./styles.css";

import { CallControlsWindow } from "./call_controls_window";
import { Root } from "./root";
import { AppPlugin } from "./app_plugin";

const CALL_CONTROLS_WINDOW_LABEL = "call-controls";

function resolveRootComponent() {
    try {
        const label = getCurrentWebviewWindow().label;
        return label === CALL_CONTROLS_WINDOW_LABEL ? CallControlsWindow : Root;
    } catch {
        return Root;
    }
}

async function start() {
    try {
        console.log("Starting Owl App...");
        const app = new OwlApp({ plugins: [AppPlugin] });
        const RootComponent = resolveRootComponent();
        const rootComponent = app.createRoot(RootComponent);
        const target = document.getElementById("app");
        await rootComponent.mount(target!);
    } catch (e) {
        console.error("Error starting Owl App:", e);
        document.body.innerHTML = `
            <div style="color:red; padding: 20px;">
                <h1>Error Starting App</h1>
                <pre>${e instanceof Error ? e.message + "\n" + e.stack : String(e)}</pre>
            </div>
        `;
    }
}

start();
