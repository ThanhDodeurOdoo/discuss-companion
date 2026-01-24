import { Component, plugin, computed } from "@odoo/owl";
import { AppPlugin } from "./app_plugin";

export class Root extends Component {
    static template = "discuss.Root";

    app = plugin(AppPlugin);

    keyName = computed(() => this.app.getKeyName(this.app.currentBindingCode()));
}
