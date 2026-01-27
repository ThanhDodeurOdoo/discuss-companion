import { Plugin, signal } from "@odoo/owl";
import { executeInMainWorld } from "../utils";

const IS_FIREFOX = /Firefox/i.test(navigator.userAgent);

export enum StatusCode {
    Default = 0,
    Saving = 1,
    Success = 2,
    InvalidPort = 3
}

export class PopupPlugin extends Plugin {
    port = signal(49152);
    statusCode = signal(StatusCode.Default);
    isOdoo = signal(false);
    serverVersion = signal("");
    owlVersion = signal("");
    isLoggingEnabled = signal(true);

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
         * and setup communication with the extension.
         * Maybe even an override of rtc_service?
         */
    }

    get isStatusDefault() {
        return this.statusCode() === StatusCode.Default || this.statusCode() === StatusCode.Saving;
    }

    get isStatusSuccess() {
        return this.statusCode() === StatusCode.Success;
    }

    get isStatusError() {
        return this.statusCode() === StatusCode.InvalidPort;
    }

    get statusText() {
        switch (this.statusCode()) {
            case StatusCode.Saving:
                return "Saving...";
            case StatusCode.Success:
                return "Options saved. Extension reloading connection...";
            case StatusCode.InvalidPort:
                return "Invalid port number.";
            case StatusCode.Default:
            default:
                return "";
        }
    }

    openShortcuts() {
        if (IS_FIREFOX) {
            // @ts-expect-error browser is not defined
            browser.commands.openShortcutSettings();
        } else {
            chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
        }
    }

    async restoreOptions() {
        const items = (await chrome.storage.local.get({
            wsPort: 49152,
            isLoggingEnabled: true
        })) as { wsPort: number; isLoggingEnabled: boolean };
        this.port.set(items.wsPort);
        this.isLoggingEnabled.set(items.isLoggingEnabled);
    }

    async save() {
        this.statusCode.set(StatusCode.Saving);

        const portNum = this.port();
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            this.statusCode.set(StatusCode.InvalidPort);
            return;
        }

        await chrome.storage.local.set({ wsPort: portNum });
        this.statusCode.set(StatusCode.Success);

        setTimeout(() => {
            if (this.statusCode() === StatusCode.Success) {
                this.statusCode.set(StatusCode.Default);
            }
        }, 2000);
    }

    async updateLogging() {
        await chrome.storage.local.set({
            isLoggingEnabled: this.isLoggingEnabled()
        });
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
