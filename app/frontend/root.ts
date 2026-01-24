import { Component, plugin, computed } from "@odoo/owl";
import { AppPlugin } from "./app_plugin";

export class Root extends Component {
    static template = "discuss.Root";

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
