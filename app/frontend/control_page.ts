import { Component, plugin, computed } from "@odoo/owl";
import "./control_page.css";

import { AppPlugin } from "./app_plugin";

export class ControlPage extends Component {
    static template = "discuss.ControlPage";
    app = plugin(AppPlugin);

    keyName = computed(() => {
        const binding = this.app.currentBinding();
        return this.app.formatKeyBinding(binding.code, binding.modifiers);
    });

    keySymbol = computed(() => {
        const binding = this.app.currentBinding();
        return this.app.formatKeySymbol(binding.code, binding.modifiers);
    });
}
