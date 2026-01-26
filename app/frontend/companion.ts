import { Component, xml, plugin } from "@odoo/owl";
import "./companion.css";
import { AppPlugin } from "./app_plugin";
import { ControlPage } from "./control_page";
import { LogPage } from "./log_page";
import { SettingsPage } from "./settings_page";
import { Header } from "./header";
import { Footer } from "./footer";
import template from "./companion.xml?raw";

export class Companion extends Component {
    static template = xml`${template}`;
    static components = { ControlPage, LogPage, SettingsPage, Header, Footer };
    app = plugin(AppPlugin);
}
