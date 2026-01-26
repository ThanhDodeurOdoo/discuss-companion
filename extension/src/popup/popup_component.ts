import { Component, plugin } from "@odoo/owl";
import { PopupPlugin } from "./popup_plugin";

export class Popup extends Component {
    static template = "Popup";
    popup = plugin(PopupPlugin);
}
