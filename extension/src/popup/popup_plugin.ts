import { Plugin, signal, computed } from "@odoo/owl";
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
    hasCallTab = signal(false);
    isStatusDefault = computed(
        () => this.statusCode() === StatusCode.Default || this.statusCode() === StatusCode.Saving
    );
    isStatusSuccess = computed(() => this.statusCode() === StatusCode.Success);
    isStatusError = computed(() => this.statusCode() === StatusCode.InvalidPort);
    statusText = computed(() => {
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
    });

    setup() {
        this.restoreOptions();
        this.checkIsOdoo();
        this.updateHasCallTab();
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

    openShortcuts() {
        if (IS_FIREFOX) {
            // @ts-expect-error browser is not defined
            browser.commands.openShortcutSettings();
        } else {
            chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
        }
    }

    async updateHasCallTab() {
        const { isTalkingByTabId = {} } = (await chrome.storage.session.get(
            "isTalkingByTabId"
        )) as {
            isTalkingByTabId: Record<string, boolean>;
        };
        console.log("isTalkingByTabId", Object.keys(isTalkingByTabId));
        this.hasCallTab.set(Object.keys(isTalkingByTabId).length > 0);
    }

    async goToCall() {
        const { isTalkingByTabId = {} } = (await chrome.storage.session.get(
            "isTalkingByTabId"
        )) as {
            isTalkingByTabId: Record<string, boolean>;
        };
        const tabIds = Object.keys(isTalkingByTabId);
        if (tabIds.length > 0) {
            const tabId = parseInt(tabIds[0], 10);
            try {
                const tab = await chrome.tabs.get(tabId);
                if (tab) {
                    await chrome.tabs.update(tabId, { active: true });
                    await chrome.windows.update(tab.windowId, { focused: true });
                    // could even execute on that tab a: "odoo.__WOWL_DEBUG__.root.env.services["mail.store"].rtc?.channel?.open()"
                    window.close();
                }
            } catch (e) {
                console.error("Failed to focus tab", e);
            }
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
