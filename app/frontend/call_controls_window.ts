import { Component, plugin, xml } from "@odoo/owl";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { AppPlugin } from "./app_plugin";
import "./call_controls_window.css";
import "./control_page.css";
import template from "./call_controls_window.xml?raw";

export class CallControlsWindow extends Component {
    static template = xml`${template}`;
    app = plugin(AppPlugin);

    /**
     * TODO: Fixme, does not work, but not a big deal as
     * we toggle this window with the tray icon.
     */
    async hideWindow() {
        await getCurrentWebviewWindow().hide();
    }
}
