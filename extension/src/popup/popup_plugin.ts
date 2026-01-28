import { Plugin, signal, computed } from "@odoo/owl";
import { executeInCurrentTab, executeInCallTab } from "../utils";

const IS_FIREFOX = /Firefox/i.test(navigator.userAgent);

export enum StatusCode {
    Default = 0,
    Saving = 1,
    Success = 2,
    InvalidPort = 3
}

type CallState = {
    isMute: boolean;
    isDeaf: boolean;
    isCameraOn: boolean;
    isScreenOn: boolean;
};

function readCallStateInTab(): CallState | undefined {
    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    const selfSession = store?.rtc?.selfSession;
    if (!selfSession) {
        return undefined;
    }
    return {
        isMute: selfSession.isMute,
        isDeaf: selfSession.is_deaf,
        isCameraOn: selfSession.is_camera_on,
        isScreenOn: selfSession.is_screen_sharing_on
    };
}

async function toggleMicrophoneInTab() {
    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    if (!store?.rtc?.selfSession) {
        return false;
    }
    await store.rtc.toggleMicrophone();
    return true;
}

async function toggleDeafenInTab() {
    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    if (!store?.rtc?.selfSession) {
        return false;
    }
    await store.rtc.toggleDeafen();
    return true;
}

async function toggleCameraInTab() {
    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    if (!store?.rtc?.selfSession) {
        return false;
    }
    await store.rtc.toggleVideo("camera");
    return true;
}

async function toggleScreenInTab() {
    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    if (!store?.rtc?.selfSession) {
        return false;
    }
    await store.rtc.toggleVideo("screen");
    return true;
}

async function leaveCallInTab() {
    const store = window.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    if (!store?.rtc?.leaveCall) {
        return false;
    }
    await store.rtc.leaveCall();
    return true;
}

export class PopupPlugin extends Plugin {
    port = signal(49152);
    statusCode = signal(StatusCode.Default);
    isOdoo = signal(false);
    serverVersion = signal("");
    owlVersion = signal("");
    isLoggingEnabled = signal(false);
    hasCallTab = signal(false);
    isMute = signal(false);
    isDeaf = signal(false);
    isCameraOn = signal(false);
    isScreenOn = signal(false);
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
        this.collectCurrentTabData();
        this.collectCallTabData();
    }

    openShortcuts() {
        if (IS_FIREFOX) {
            // @ts-expect-error browser is not defined
            browser.commands.openShortcutSettings();
        } else {
            chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
        }
    }

    async onClickGoToCall() {
        await this.goToCall();
        window.close();
    }

    async collectCurrentTabData() {
        const result = await executeInCurrentTab(() => {
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

    async collectCallTabData() {
        const { isTalkingByTabId = {} } = (await chrome.storage.session.get(
            "isTalkingByTabId"
        )) as {
            isTalkingByTabId: Record<string, boolean>;
        };
        const hasCall = Object.keys(isTalkingByTabId).length > 0;
        this.hasCallTab.set(hasCall);
        if (hasCall) {
            await this.refreshCallState();
        } else {
            this.applyCallState();
        }
    }

    async toggleMicrophone() {
        await this.runCallAction(toggleMicrophoneInTab);
    }

    async toggleDeafen() {
        await this.runCallAction(toggleDeafenInTab);
    }

    async toggleCamera() {
        await this.runCallAction(toggleCameraInTab);
    }

    // Screen share needs the call tab focused to avoid being blocked.
    async toggleScreen() {
        await this.runCallAction(toggleScreenInTab, { focusCallTab: true });
    }

    async leaveCall() {
        const didLeave = await this.runCallAction(leaveCallInTab);
        if (didLeave) {
            await this.collectCallTabData();
        }
    }

    applyCallState(state?: {
        isMute?: boolean;
        isDeaf?: boolean;
        isCameraOn?: boolean;
        isScreenOn?: boolean;
    }) {
        this.isMute.set(Boolean(state?.isMute));
        this.isDeaf.set(Boolean(state?.isDeaf));
        this.isCameraOn.set(Boolean(state?.isCameraOn));
        this.isScreenOn.set(Boolean(state?.isScreenOn));
    }

    async refreshCallState() {
        const result = await executeInCallTab(readCallStateInTab);
        this.hasCallTab.set(Boolean(result));
        this.applyCallState(result);
        return result;
    }

    async runCallAction(
        action: () => Promise<boolean> | boolean,
        { focusCallTab = false }: { focusCallTab?: boolean } = {}
    ) {
        if (focusCallTab) {
            this.goToCall();
        }
        const didRun = await executeInCallTab(action);
        if (didRun) {
            await this.refreshCallState();
        } else {
            this.applyCallState();
        }
        return didRun;
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
                }
            } catch (e) {
                console.error("Failed to focus tab", e);
            }
        }
    }

    async restoreOptions() {
        const items = (await chrome.storage.local.get({
            wsPort: 49152,
            isLoggingEnabled: this.isLoggingEnabled()
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
}
