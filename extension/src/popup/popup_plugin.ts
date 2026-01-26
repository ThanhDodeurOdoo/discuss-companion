import { Plugin, signal } from "@odoo/owl";
import { executeInMainWorld } from "../utils";

export class PopupPlugin extends Plugin {
    port = signal(49152);
    status = signal("");
    statusColor = signal("#24292f");
    isOdoo = signal(false);
    serverVersion = signal("");
    owlVersion = signal("");

    setup() {
        this.restoreOptions();
        this.checkIsOdoo();
        /**
         * TODO: could do more fun stuff with:
         * odoo.__WOWL_DEBUG__.root.env.services["mail.store"].rtc
         * but execution should be well guarded in case
         * features change in the future
         *
         * could even use executeInMainWorld() to bootstrap some
         * kind of script that would run in the main world
         * and setup communication with the extension
         */
    }

    async restoreOptions() {
        const items = (await chrome.storage.local.get({ wsPort: 49152 })) as { wsPort: number };
        this.port.set(items.wsPort);
    }

    async save() {
        this.status.set("Saving...");
        this.statusColor.set("#24292f");

        const portNum = this.port();
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            this.status.set("Invalid port number.");
            this.statusColor.set("#cf222e");
            return;
        }

        await chrome.storage.local.set({ wsPort: portNum });
        this.status.set("Options saved. Extension reloading connection...");
        this.statusColor.set("#2da44e");

        setTimeout(() => {
            this.status.set("");
        }, 2000);
    }

    updatePort(value: string) {
        this.port.set(parseInt(value) || 0);
    }

    async checkIsOdoo() {
        const result = await executeInMainWorld(() => {
            const isOdoo = Boolean(window.owl && window.odoo);
            if (!isOdoo) {
                return { isOdoo };
            }
            return {
                isOdoo,
                serverVersion: window.odoo?.info?.server_version || "Unknown",
                owlVersion: window.owl?.__info__?.version || "Unknown"
            };
        });

        const finalResult = result || { isOdoo: false };
        this.isOdoo.set(finalResult.isOdoo);
        if (finalResult.isOdoo) {
            this.serverVersion.set(finalResult.serverVersion!);
            this.owlVersion.set(finalResult.owlVersion!);
        }
    }
}
