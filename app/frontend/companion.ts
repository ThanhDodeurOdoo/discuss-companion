import { Component, xml } from "@odoo/owl";
import "./companion.css";
import { ControlPage } from "./control_page";
import { LogPage } from "./log_page";
import { Header } from "./header";
import { Footer } from "./footer";
import template from "./companion.xml?raw";

export class Companion extends Component {
    static template = xml`${template}`;
    static components = { ControlPage, LogPage, Header, Footer };
}
