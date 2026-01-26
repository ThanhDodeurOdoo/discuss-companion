import { Plugin, signal } from "@odoo/owl";

export class PopupPlugin extends Plugin {
    port = signal(49152);
    status = signal("");
    statusColor = signal("#24292f");

    setup() {
        this.restoreOptions();
    }

    async restoreOptions() {
        console.log("[Discuss Companion Options] Restoring options...");
        const items = (await chrome.storage.local.get({ wsPort: 49152 })) as { wsPort: number };
        this.port.set(items.wsPort);
        console.log("[Discuss Companion Options] Options restored. Port:", items.wsPort);
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

        console.log("[Discuss Companion Options] Saving port:", portNum);

        await chrome.storage.local.set({ wsPort: portNum });
        this.status.set("Options saved. Extension reloading connection...");
        this.statusColor.set("#2da44e");
        console.log("[Discuss Companion Options] Port saved.");

        setTimeout(() => {
            this.status.set("");
        }, 2000);
    }

    updatePort(value: string) {
        this.port.set(parseInt(value) || 0);
    }
}
