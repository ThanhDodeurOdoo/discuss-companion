import { Component, onMounted, onWillUnmount, plugin, signal, xml } from "@odoo/owl";
import { AppPlugin } from "./app_plugin";
import template from "./permission_page.xml?raw";
import "./permission_page.css";

export class PermissionPage extends Component {
    static template = xml`${template}`;
    app = plugin(AppPlugin);
    dialog = signal<HTMLDialogElement | null>(null);
    reviewButton = signal<HTMLButtonElement | null>(null);
    hasNativeDialog =
        typeof HTMLDialogElement !== "undefined" &&
        typeof HTMLDialogElement.prototype.showModal === "function";

    setup() {
        onMounted(() => {
            if (this.app.permissionReviewOpen()) {
                this.showDetails();
            }
        });
        onWillUnmount(() => {
            // Unmounting or quitting must not dismiss the persisted setup flow.
            this.closeDialog();
        });
    }

    openDetails() {
        this.app.setPermissionReviewOpen(true);
        this.showDetails();
    }

    showDetails() {
        const dialog = this.dialog();
        if (!dialog || dialog.hasAttribute("open")) {
            return;
        }
        // WebKit does not always focus buttons on click. Give the native dialog
        // an explicit return target for Escape and close.
        this.reviewButton()?.focus();
        if (this.hasNativeDialog) {
            dialog?.showModal();
        } else {
            // Older macOS WebViews still need access to permission recovery.
            dialog?.setAttribute("open", "");
            dialog?.querySelector<HTMLButtonElement>("button")?.focus();
        }
    }

    closeDetails() {
        this.closeDialog();
        this.app.setPermissionReviewOpen(false);
        queueMicrotask(() => {
            if (this.app.permissionGranted()) {
                document.querySelector<HTMLButtonElement>(".key-display")?.focus();
            } else {
                this.reviewButton()?.focus();
            }
        });
    }

    closeDialog() {
        if (!this.dialog()?.hasAttribute("open")) {
            return;
        }
        if (this.hasNativeDialog) {
            this.dialog()?.close();
        } else {
            this.dialog()?.removeAttribute("open");
        }
    }

    onDialogCancel(event: Event) {
        event.preventDefault();
        this.closeDetails();
    }

    onDialogClick(event: MouseEvent) {
        const dialog = this.dialog();
        if (!dialog || event.target !== dialog) {
            return;
        }
        // A backdrop click targets the dialog too; padding inside it must not close it.
        const bounds = dialog.getBoundingClientRect();
        if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
        ) {
            this.closeDetails();
        }
    }
}
