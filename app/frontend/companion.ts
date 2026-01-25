import { Component } from "@odoo/owl";
import "./companion.css";

import { Header } from "./header";
import { Footer } from "./footer";
import { ControlPage } from "./control_page";
import { LogPage } from "./log_page";

export class Companion extends Component {
    static template = "discuss.Companion";
    static components = { Header, Footer, ControlPage, LogPage };
}
