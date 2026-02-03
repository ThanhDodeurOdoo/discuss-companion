import { Plugin, signal, computed } from "@odoo/owl";
import { executeInCurrentTab } from "../utils";
import { CallActionType, type CallAction } from "../call_actions";
import { requestCallAction, requestCallState, requestFocusCallTab } from "../command_api";
import { CallState, getCallTabId, getStoredCallState } from "../call_state";
import { IS_FIREFOX_BUILD } from "../env";

const EXTENSION_VERSION = __EXTENSION_VERSION__;

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
    isLoggingEnabled = signal(false);
    isCompanionEnabled = signal(false);
    hasCallTab = signal(false);
    extensionVersion = signal(EXTENSION_VERSION);
    isFirefoxBuild = IS_FIREFOX_BUILD;
    isMute = signal(false);
    isDeaf = signal(false);
    isCameraOn = signal(false);
    isScreenOn = signal(false);
    isSettingsOpen = signal(false);
    lastJoinedCall = signal<{ url: string; name: string } | null>(null);
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
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== "session") {
                return;
            }
            if (changes.callState) {
                const nextState = changes.callState.newValue as CallState | null | undefined;
                this.applyCallState(nextState ?? undefined);
            }
            if (changes.callTabId) {
                this.hasCallTab.set(Boolean(changes.callTabId.newValue));
            }
        });
    }

    openShortcuts() {
        if (IS_FIREFOX_BUILD) {
            return;
        }
        chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    }

    async onClickGoToCall() {
        await this.goToCall();
        window.close();
    }

    async rejoinLastCall() {
        const call = this.lastJoinedCall();
        if (call?.url) {
            await chrome.tabs.create({ url: call.url });
            window.close();
        }
    }

    toggleSettings() {
        this.isSettingsOpen.set(!this.isSettingsOpen());
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
        const callTabId = await getCallTabId();
        this.hasCallTab.set(Boolean(callTabId));
        if (callTabId !== null) {
            const state = await requestCallState();
            this.applyCallState(state);
            return;
        }
        const storedState = await getStoredCallState();
        this.applyCallState(storedState);
    }

    async toggleMicrophone() {
        await this.runCallAction({ type: CallActionType.ToggleMicrophone });
    }

    async toggleDeafen() {
        await this.runCallAction({ type: CallActionType.ToggleDeafen });
    }

    async toggleCamera() {
        await this.runCallAction({ type: CallActionType.ToggleCamera });
    }

    // Screen share needs the call tab focused to avoid being blocked.
    async toggleScreen() {
        // Routed through the service worker so focus is applied from the SW thread;
        // this can close the popup when the call tab is focused.
        await this.runCallAction({ type: CallActionType.ToggleScreen }, { focusCallTab: true });
    }

    async openPip() {
        await this.runCallAction({ type: CallActionType.OpenPip });
    }

    async leaveCall() {
        const didLeave = await this.runCallAction({ type: CallActionType.LeaveCall });
        if (didLeave) {
            await this.collectCallTabData();
        }
    }

    applyCallState(state?: Partial<CallState>) {
        this.isMute.set(Boolean(state?.isMute));
        this.isDeaf.set(Boolean(state?.isDeaf));
        this.isCameraOn.set(Boolean(state?.isCameraOn));
        this.isScreenOn.set(Boolean(state?.isScreenOn));
    }

    async runCallAction(
        action: CallAction,
        { focusCallTab = false }: { focusCallTab?: boolean } = {}
    ) {
        const result = await requestCallAction(action, { focusCallTab });
        if (!result) {
            return false;
        }
        this.applyCallState(result.state);
        return result.didRun;
    }

    async goToCall() {
        await requestFocusCallTab();
    }

    async restoreOptions() {
        const items = (await chrome.storage.local.get({
            wsPort: 49152,
            isLoggingEnabled: this.isLoggingEnabled(),
            isCompanionEnabled: this.isCompanionEnabled(),
            lastJoinedCall: null
        })) as {
            wsPort: number;
            isLoggingEnabled: boolean;
            isCompanionEnabled: boolean;
            lastJoinedCall: { url: string; name: string } | null;
        };
        this.port.set(items.wsPort);
        this.isLoggingEnabled.set(items.isLoggingEnabled);
        this.isCompanionEnabled.set(items.isCompanionEnabled);
        this.lastJoinedCall.set(items.lastJoinedCall);
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

    async updateCompanionEnabled() {
        await chrome.storage.local.set({
            isCompanionEnabled: this.isCompanionEnabled()
        });
    }
}
