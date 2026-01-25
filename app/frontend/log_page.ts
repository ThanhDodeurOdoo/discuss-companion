import { Component, plugin, xml } from "@odoo/owl";
import "./log_page.css";
import { AppPlugin } from "./app_plugin";
import template from "./log_page.xml?raw";

export class LogPage extends Component {
    static template = xml`${template}`;
    app = plugin(AppPlugin);
}
