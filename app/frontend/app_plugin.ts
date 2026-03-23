import { Plugin, signal, onWillDestroy } from "@odoo/owl";
import { listen } from "@tauri-apps/api/event";
import { KEY_MAP, KEY_SYMBOL_MAP, MODIFIER_SYMBOLS, MODIFIER_NAMES } from "./utils";
import * as ipc from "./ipc";
import {
    ChannelEventType,
    type ChannelEvent,
    type CallStatePayload,
    APP_VISIBILITY_MODE,
    type AppVisibilityMode
} from "./ipc_types";

const THEME_STORAGE_KEY = "discuss-companion.theme";

const THEME_MODE = {
    Dark: "dark",
    Light: "light"
} as const;

type ThemeMode = (typeof THEME_MODE)[keyof typeof THEME_MODE];

/**
 * The default port should be the same as the backend default port,
 * TODO: maybe some kind of project-wide default port const
 */
const DEFAULT_PORT = 49152;

type LogEntry = {
    id: number;
    ts: string;
    type: string;
    message: string;
};

type PttBinding = {
    code: number;
    modifiers: number[];
};

type BindingCapturedPayload = {
    ts: number;
    key: PttBinding;
};

type CompanionFeatures = {
    ptt: boolean;
    callControlsTray: boolean;
};

const MAX_LOGS = 20;
const MODIFIER_ORDER: Record<string, number> = { Cmd: 0, Ctrl: 1, Option: 2, Shift: 3 };

export class AppPlugin extends Plugin {
    static id = "AppPlugin";

    appVisibilityModes = APP_VISIBILITY_MODE;
    themeModes = THEME_MODE;

    features = signal<CompanionFeatures>({
        ptt: false,
        callControlsTray: false
    });

    // App settings
    appVisibilityMode = signal<AppVisibilityMode>(APP_VISIBILITY_MODE.TrayAndDockWhenWindowOpen);
    showSymbols = signal(true);
    themeMode = signal<ThemeMode>(THEME_MODE.Dark);
    wsPort = signal(DEFAULT_PORT);
    isWsReloading = signal(false);

    // App
    logs = signal.Array<LogEntry>([]);
    showSettings = signal(false);

    // PTT
    isRecording = signal(false);
    isPressed = signal(false);
    permissionGranted = signal(false);
    extensionConnected = signal(false);
    currentBinding = signal<PttBinding>({ code: 0, modifiers: [] });
    isForcingRelease = false;

    // Call
    hasCallTab = signal(false);
    callStateKnown = signal(false);
    isMute = signal(false);
    isDeaf = signal(false);
    isCameraOn = signal(false);
    isScreenOn = signal(false);

    logIdCounter = 0;
    unlistenFns: (() => void)[] = [];
    permissionInterval: number | null = null;

    setup() {
        this.initThemeMode();
        this.init();
        onWillDestroy(() => {
            this.unlistenFns.forEach((fn) => fn());
        });
    }

    initThemeMode() {
        try {
            const mode = window?.localStorage?.getItem(THEME_STORAGE_KEY);
            if (mode === THEME_MODE.Dark || mode === THEME_MODE.Light) {
                this.themeMode.set(mode);
                this.applyThemeMode(mode);
            }
        } catch {
            // Keep default
        }
    }

    applyThemeMode(mode: ThemeMode) {
        if (typeof document === "undefined") {
            return;
        }
        document.documentElement.setAttribute("data-theme", mode);
    }

    setThemeMode(mode: ThemeMode) {
        if (this.themeMode() === mode) {
            return;
        }
        this.themeMode.set(mode);
        this.applyThemeMode(mode);
        if (typeof window === "undefined") {
            return;
        }
        try {
            window.localStorage.setItem(THEME_STORAGE_KEY, mode);
        } catch {
            // Ignore persistence errors and keep runtime theme.
        }
    }

    async init() {
        this.addLog("SYSTEM", "Ready");
        await this.fetchFeatures();
        if (this.features().callControlsTray) {
            await this.fetchAppVisibilityMode();
        }
        await this.fetchCurrentBinding();
        await this.fetchWsPort();
        await this.checkPermission();
        await this.setupListeners();
    }

    async setupListeners() {
        const connected = await ipc.isExtensionConnected();
        this.extensionConnected.set(connected);

        await ipc.setupChannel(async (event: ChannelEvent) => {
            switch (event.type) {
                case ChannelEventType.PttEvent: {
                    const payload = event.payload;
                    if (this.isRecording()) {
                        await this.applyRecordedBinding(payload.key);
                        return;
                    }

                    if (payload.type === "ptt_down") {
                        this.isPressed.set(true);
                    } else {
                        this.isPressed.set(false);
                    }

                    if (payload.type === "ptt_down" && payload.is_repeat) {
                        return;
                    }

                    if (payload.type === "ptt_up" && this.isForcingRelease) {
                        this.isForcingRelease = false;
                        return;
                    }

                    const type = payload.type === "ptt_down" ? "DOWN" : "UP";
                    this.addLog(
                        type,
                        `Key: ${this.formatKeyBinding(payload.key.code, payload.key.modifiers)}`
                    );
                    break;
                }
                case ChannelEventType.Error: {
                    this.addLog("ERROR", event.payload);
                    break;
                }
                case ChannelEventType.WsConnection: {
                    this.extensionConnected.set(true);
                    this.addLog("WS", "websocket connected");
                    break;
                }
                case ChannelEventType.WsDisconnection: {
                    this.extensionConnected.set(false);
                    this.clearCallState();
                    this.addLog("WS", "websocket disconnected");
                    break;
                }
                case ChannelEventType.CallState: {
                    const payload = event.payload;
                    this.addLog("CALL-STATE", this.formatCallStateLog(payload));
                    this.applyCallState(payload);
                    break;
                }
                case ChannelEventType.WsMessage: {
                    this.addLog("WS-MSG", JSON.stringify(event.payload));
                    break;
                }
            }
        });

        const bindingCapturedUnlisten = await listen<BindingCapturedPayload>(
            "binding-captured",
            async (event) => {
                if (!this.isRecording()) {
                    return;
                }
                await this.applyRecordedBinding(event.payload.key);
            }
        );

        type WsStatusPayload = {
            status: string;
            port: number;
        };

        const wsStatusUnlisten = await listen<WsStatusPayload>("ws-server-status", (event) => {
            this.addLog("WS-STATUS", JSON.stringify(event.payload));
            if (event.payload.status === "restarted") {
                this.wsPort.set(event.payload.port);
                this.isWsReloading.set(false);
                this.addLog("SYSTEM", `WS Server restarted on port ${event.payload.port}`);
            }
        });

        this.unlistenFns.push(bindingCapturedUnlisten);
        this.unlistenFns.push(wsStatusUnlisten);
    }

    async applyRecordedBinding(binding: PttBinding) {
        this.isRecording.set(false);
        this.isPressed.set(false);
        await ipc.setRecordingMode(false);
        await ipc.updateBinding(binding.code, binding.modifiers);
        this.currentBinding.set(binding);
        this.addLog(
            "SYSTEM",
            `Key binding updated to: ${this.formatKeyBinding(binding.code, binding.modifiers)}`
        );
    }

    async fetchFeatures() {
        try {
            const features = await ipc.getFeatures();
            if (features) {
                this.features.set(features);
            }
        } catch (error) {
            this.addLog("ERROR", `Failed to load features: ${String(error)}`);
        }
    }

    async fetchAppVisibilityMode() {
        try {
            const mode = await ipc.getAppVisibilityMode();
            if (mode) {
                this.appVisibilityMode.set(mode);
            }
        } catch (error) {
            this.addLog("ERROR", `Failed to load app visibility: ${String(error)}`);
        }
    }

    async setAppVisibilityMode(mode: AppVisibilityMode) {
        if (this.appVisibilityMode() === mode) {
            return;
        }
        const previous = this.appVisibilityMode();
        this.appVisibilityMode.set(mode);
        try {
            await ipc.setAppVisibilityMode(mode);
            this.addLog("SYSTEM", `App visibility set to ${mode}`);
        } catch (error) {
            this.appVisibilityMode.set(previous);
            this.addLog("ERROR", `Failed to update app visibility: ${String(error)}`);
        }
    }

    async checkPermission() {
        const isGranted = await ipc.isAccessibilityGranted();
        this.permissionGranted.set(isGranted);
    }

    async fetchCurrentBinding() {
        const binding = await ipc.getCurrentBinding();
        if (binding) {
            this.currentBinding.set(binding);
        }
    }

    async fetchWsPort() {
        const port = await ipc.getWsPort();
        this.wsPort.set(port);
        this.addLog("SYSTEM", `Current WS Port: ${port}`);
    }

    async reloadWsServer() {
        const rawPort = this.wsPort();
        const port = Number(rawPort);

        if (isNaN(port) || port < 1024 || port > 65535) {
            this.addLog("ERROR", "Invalid port. Must be between 1024 and 65535.");
            return;
        }

        try {
            const currentPort = await ipc.getWsPort();
            if (port === currentPort) {
                this.addLog("SYSTEM", "Port unchanged, skipping reload");
                return;
            }

            this.addLog("SYSTEM", `Initiating WS server reload to port: ${port}`);
            this.isWsReloading.set(true);
            await ipc.updateWsPort(port);
            this.addLog("SYSTEM", "Reload command sent to backend");
        } catch (e) {
            this.addLog("ERROR", `Failed to reload WS server: ${e}`);
            this.isWsReloading.set(false);
        }
    }

    async toggleRecording() {
        if (this.isRecording()) {
            this.isRecording.set(false);
            await ipc.setRecordingMode(false);
            await this.fetchCurrentBinding();
        } else {
            this.isRecording.set(true);
            await ipc.setRecordingMode(true);
        }
    }

    async forceRelease() {
        this.addLog("SYSTEM", "Safety release triggered");
        this.isForcingRelease = true;
        this.isPressed.set(false);
        await ipc.forcePttUp();
    }

    hasActiveCall(): boolean {
        return this.extensionConnected() && this.hasCallTab();
    }

    canUseCallToggles(): boolean {
        return this.hasActiveCall() && this.callStateKnown();
    }

    callStatusText(): string {
        if (!this.extensionConnected()) {
            return "Extension offline";
        }
        if (!this.hasCallTab()) {
            return "No active call";
        }
        if (!this.callStateKnown()) {
            return "Syncing call state...";
        }
        return "Call active";
    }

    callStatusClass(): string {
        if (!this.extensionConnected()) {
            return "offline";
        }
        if (!this.hasCallTab()) {
            return "inactive";
        }
        if (!this.callStateKnown()) {
            return "syncing";
        }
        return "active";
    }

    applyCallState(state: CallStatePayload) {
        this.hasCallTab.set(state.hasCall);
        this.callStateKnown.set(state.hasState);
        if (state.hasState) {
            this.isMute.set(state.isMute);
            this.isDeaf.set(state.isDeaf);
            this.isCameraOn.set(state.isCameraOn);
            this.isScreenOn.set(state.isScreenOn);
            return;
        }
        this.isMute.set(false);
        this.isDeaf.set(false);
        this.isCameraOn.set(false);
        this.isScreenOn.set(false);
    }

    formatCallStateLog(state: CallStatePayload): string {
        if (!state.hasCall) {
            return "No active call";
        }
        if (!state.hasState) {
            return "Call state syncing";
        }
        const flags = [
            `mute:${state.isMute}`,
            `deaf:${state.isDeaf}`,
            `camera:${state.isCameraOn}`,
            `screen:${state.isScreenOn}`
        ];
        return `Call state updated (${flags.join(", ")})`;
    }

    clearCallState() {
        this.applyCallState({
            hasCall: false,
            hasState: false,
            isMute: false,
            isDeaf: false,
            isCameraOn: false,
            isScreenOn: false
        });
    }

    async toggleMute() {
        if (!this.canUseCallToggles()) {
            return;
        }
        const didSend = await ipc.setMute(!this.isMute());
        this.logCallResult(didSend, `Mute: ${!this.isMute()}`);
    }

    async toggleDeafen() {
        if (!this.canUseCallToggles()) {
            return;
        }
        const didSend = await ipc.setDeaf(!this.isDeaf());
        this.logCallResult(didSend, `Deafen: ${!this.isDeaf()}`);
    }

    async toggleCamera() {
        if (!this.canUseCallToggles()) {
            return;
        }
        const didSend = await ipc.setCamera(!this.isCameraOn());
        this.logCallResult(didSend, `Camera: ${!this.isCameraOn()}`);
    }

    async toggleScreen() {
        if (!this.canUseCallToggles()) {
            return;
        }
        const didSend = await ipc.setScreen(!this.isScreenOn());
        this.logCallResult(didSend, `Screen: ${!this.isScreenOn()}`);
    }

    async openPip() {
        if (!this.hasActiveCall()) {
            return;
        }
        const didSend = await ipc.openPip();
        this.logCallResult(didSend, "Open PiP");
    }

    async leaveCall() {
        if (!this.hasActiveCall()) {
            return;
        }
        const didSend = await ipc.leaveCall();
        this.logCallResult(didSend, "Leave call");
    }

    async goToCall() {
        if (!this.hasActiveCall()) {
            return;
        }
        const didSend = await ipc.focusCallTab();
        this.logCallResult(didSend, "Go to call");
    }

    private logCallResult(didSend: boolean, description: string) {
        if (!didSend) {
            this.addLog("CALL", "Failed to reach extension");
            return;
        }
        this.addLog("CALL", `Sent ${description}`);
    }

    // TODO isolate in its own logger util, shouldn't take string literal but rather an enum, or expose individually named functions
    addLog(type: string, message: string) {
        const time = new Date().toLocaleTimeString("en-US", {
            hour12: false
        });

        this.logs().unshift({
            id: ++this.logIdCounter,
            ts: time,
            type,
            message
        });

        if (this.logs().length > MAX_LOGS) {
            this.logs().pop();
        }
    }

    clearLogs() {
        this.logs.set([]);
    }

    toggleSettings() {
        this.showSettings.set(!this.showSettings());
    }

    formatKeyBinding(code: number, modifiers: number[] = []): string {
        const keyName = KEY_MAP[code] || `Key ${code}`;
        const formattedModifiers = modifiers
            .map((m) => {
                const name = MODIFIER_NAMES[m] || "";
                switch (name) {
                    case "meta":
                        return "Cmd";
                    case "alt":
                        return "Option";
                    case "ctrl":
                        return "Ctrl";
                    case "shift":
                        return "Shift";
                    default:
                        return name;
                }
            })
            .filter((s) => s !== "")
            .sort((a, b) => (MODIFIER_ORDER[a] ?? 99) - (MODIFIER_ORDER[b] ?? 99));

        if (formattedModifiers.length > 0) {
            return `${formattedModifiers.join("+")}+${keyName}`;
        }
        return keyName;
    }

    formatKeySymbol(code: number, modifiers: number[] = []): string {
        const keySymbol = KEY_SYMBOL_MAP[code] || KEY_MAP[code] || "";

        const sortedModifierNames = modifiers
            .map((m) => MODIFIER_NAMES[m] || "")
            .filter((name) => name !== "")
            .sort((a, b) => (MODIFIER_ORDER[a] ?? 99) - (MODIFIER_ORDER[b] ?? 99));

        const symbolString = sortedModifierNames
            .map((name) => MODIFIER_SYMBOLS[name] || "")
            .join("");

        return `${symbolString}${keySymbol}`;
    }

    async showMainWindow() {
        await ipc.showMainWindow();
    }

    async quitApp() {
        await ipc.quitApp();
    }
}
