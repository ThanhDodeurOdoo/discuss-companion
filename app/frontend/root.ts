import { Component, plugin } from "@odoo/owl";
import { AppPlugin } from "./app_plugin";
import { Companion } from "./companion";

export class Root extends Component {
    static template = "discuss.Root";
    static components = { Companion };

    app = plugin(AppPlugin);
}
