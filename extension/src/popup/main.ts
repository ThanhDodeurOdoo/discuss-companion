import { App as OwlApp } from "@odoo/owl";
import { Popup } from "@extension/src/popup/popup_component";
import { PopupPlugin } from "@extension/src/popup/popup_plugin";
import { templates } from "@extension/src/popup/popup.xml";
import "./popup.css";

async function start() {
    const app = new OwlApp({
        plugins: [PopupPlugin],
        templates
    });
    const rootComponent = app.createRoot(Popup);
    const target = document.getElementById("app");
    if (target) {
        await rootComponent.mount(target);
    }
}

start();
