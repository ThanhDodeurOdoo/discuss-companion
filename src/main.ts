import { Component, plugin, App as OwlApp } from "@odoo/owl";
import { AppPlugin } from "./app_plugin";
import appTemplate from "./App.xml?raw"; // Use Vite's raw import

class App extends Component {
    static template = "discuss.Companion";

    app = plugin(AppPlugin);

    getKeyName(code: number) {
        return this.app.getKeyName(code);
    }
}

async function start() {
    try {
        console.log("Starting Owl App...");
        const app = new OwlApp({ plugins: [AppPlugin] });
        if (!appTemplate) {
            throw new Error("App template not loaded");
        }
        app.addTemplates(appTemplate);

        const root = app.createRoot(App);
        const target = document.getElementById("app");
        if (target) {
            await root.mount(target);
            console.log("Owl App mounted successfully");
        } else {
            throw new Error("#app element not found");
        }
    } catch (e) {
        console.error("Error starting Owl App:", e);
        document.body.innerHTML = `<div style="color:red; padding: 20px;">
            <h1>Error Starting App</h1>
            <pre>${e instanceof Error ? e.message + "\n" + e.stack : String(e)}</pre>
        </div>`;
    }
}

start();
