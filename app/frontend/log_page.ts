import { Component, plugin } from "@odoo/owl";
import "./log_page.css";

import { AppPlugin } from "./app_plugin";

export class LogPage extends Component {
    static template = "discuss.LogPage";
    app = plugin(AppPlugin);
}
