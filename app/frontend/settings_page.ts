import { Component, plugin, xml } from "@odoo/owl";
import "./settings_page.css";
import { AppPlugin } from "./app_plugin";
import template from "./settings_page.xml?raw";

export class SettingsPage extends Component {
    static template = xml`${template}`;
    app = plugin(AppPlugin);
}
