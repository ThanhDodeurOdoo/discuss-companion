import { App as OwlApp } from "@odoo/owl";
import { Root } from "./root";
import { AppPlugin } from "./app_plugin";
import rootTemplate from "./root.xml?raw"; // Use Vite's raw import

async function start() {
    try {
        console.log("Starting Owl App...");
        const app = new OwlApp({ plugins: [AppPlugin] });
        app.addTemplates(rootTemplate);
        const rootComponent = app.createRoot(Root);
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
