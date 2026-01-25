import { Component, plugin } from "@odoo/owl";
import "./header.css";

import { AppPlugin } from "./app_plugin";

export class Header extends Component {
    static template = "discuss.Header";
    app = plugin(AppPlugin);
}
