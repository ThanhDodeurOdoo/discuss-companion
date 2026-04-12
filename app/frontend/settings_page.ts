import { Component, plugin, xml } from "@odoo/owl";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./settings_page.css";
import { AppPlugin } from "./app_plugin";
import template from "./settings_page.xml?raw";

const BUG_REPORTS_URL = "https://github.com/ThanhDodeurOdoo/discuss-companion/issues";

export class SettingsPage extends Component {
    static template = xml`${template}`;
    app = plugin(AppPlugin);

    openBugReports() {
        return openUrl(BUG_REPORTS_URL);
    }
}
