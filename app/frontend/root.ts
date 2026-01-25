import { Component, plugin, xml } from "@odoo/owl";
import { AppPlugin } from "./app_plugin";
import { Companion } from "./companion";
import template from "./root.xml?raw";

export class Root extends Component {
    static template = xml`${template}`;
    static components = { Companion };

    app = plugin(AppPlugin);
}
