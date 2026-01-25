import { Component, plugin, xml } from "@odoo/owl";
import "./header.css";
import { AppPlugin } from "./app_plugin";
import template from "./header.xml?raw";

export class Header extends Component {
    static template = xml`${template}`;
    app = plugin(AppPlugin);
}
