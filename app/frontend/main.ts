import { App as OwlApp } from "@odoo/owl";
import "./styles.css";

import { Root } from "./root";
import { AppPlugin } from "./app_plugin";
import rootTemplate from "./root.xml?raw";
import companionTemplate from "./companion.xml?raw";
import headerTemplate from "./header.xml?raw";
import footerTemplate from "./footer.xml?raw";
import controlPageTemplate from "./control_page.xml?raw";
import logPageTemplate from "./log_page.xml?raw";

async function start() {
    try {
        console.log("Starting Owl App...");
        const app = new OwlApp({ plugins: [AppPlugin] });
        app.addTemplates(rootTemplate);
        app.addTemplates(companionTemplate);
        app.addTemplates(headerTemplate);
        app.addTemplates(footerTemplate);
        app.addTemplates(controlPageTemplate);
        app.addTemplates(logPageTemplate);
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
