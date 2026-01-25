import { Component, plugin, computed, xml } from "@odoo/owl";
import "./control_page.css";
import { AppPlugin } from "./app_plugin";
import template from "./control_page.xml?raw";

export class ControlPage extends Component {
    static template = xml`${template}`;
    app = plugin(AppPlugin);

    keyName = computed(() => {
        const { code, modifiers } = this.app.currentBinding();
        return this.app.formatKeyBinding(code, modifiers);
    });

    keySymbol = computed(() => {
        const { code, modifiers } = this.app.currentBinding();
        return this.app.formatKeySymbol(code, modifiers);
    });
}
