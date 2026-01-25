import { Component, plugin, computed, xml } from "@odoo/owl";
import "./control_page.css";
import { AppPlugin } from "./app_plugin";
import template from "./control_page.xml?raw";

export class ControlPage extends Component {
    static template = xml`${template}`;
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
