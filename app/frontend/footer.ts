import { Component, plugin } from "@odoo/owl";
import "./footer.css";

import { AppPlugin } from "./app_plugin";

export class Footer extends Component {
    static template = "discuss.Footer";
    app = plugin(AppPlugin);
}
