import { App as OwlApp } from "@odoo/owl";
import { Popup } from "./popup_component";
import { PopupPlugin } from "./popup_plugin";
import { templates } from "./popup.xml";

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
