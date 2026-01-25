import { Component, plugin, xml } from "@odoo/owl";
import "./footer.css";

import { AppPlugin } from "./app_plugin";
import template from "./footer.xml?raw";

export class Footer extends Component {
    static template = xml`${template}`;
    app = plugin(AppPlugin);
}
