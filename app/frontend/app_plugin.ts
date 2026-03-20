import { Plugin, signal, onWillDestroy } from "@odoo/owl";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { KEY_MAP, KEY_SYMBOL_MAP, MODIFIER_SYMBOLS, MODIFIER_NAMES } from "./utils";
import {
    setRecordingMode,
    updateBinding,
    updateWsPort,
    setupChannel,
    sendCallCommand
} from "./ipc";
import { ChannelEventType, type ChannelEvent, type CallStatePayload } from "./ipc_types";
import { CallCommand } from "./call_commands";

const DEFAULT_PORT = 49152;
const FEATURES_COMMAND = "get_features";
const APP_VISIBILITY_COMMAND_GET = "get_app_visibility_mode";
const APP_VISIBILITY_COMMAND_SET = "set_app_visibility_mode";
const THEME_STORAGE_KEY = "discuss-companion.theme";

const APP_VISIBILITY_MODE = {
    TrayAndDockWhenWindowOpen: "trayAndDockWhenWindowOpen",
    TrayAndDockAlways: "trayAndDockAlways",
    DockOnly: "dockOnly"
} as const;
const THEME_MODE = {
    Dark: "dark",
    Light: "light"
} as const;

type AppVisibilityMode = (typeof APP_VISIBILITY_MODE)[keyof typeof APP_VISIBILITY_MODE];
const DEFAULT_APP_VISIBILITY_MODE = APP_VISIBILITY_MODE.TrayAndDockWhenWindowOpen;
type ThemeMode = (typeof THEME_MODE)[keyof typeof THEME_MODE];
const DEFAULT_THEME_MODE = THEME_MODE.Dark;

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

const DEFAULT_FEATURES: CompanionFeatures = {
    ptt: false,
    callControlsTray: false
};

const MAX_LOGS = 20;
const MODIFIER_ORDER: Record<string, number> = { Cmd: 0, Ctrl: 1, Option: 2, Shift: 3 };

export class AppPlugin extends Plugin {
    static id = "AppPlugin";

    appVisibilityModes = APP_VISIBILITY_MODE;
    themeModes = THEME_MODE;
    isRecording = signal(false);
    isPressed = signal(false);
    showSymbols = signal(true);
    themeMode = signal<ThemeMode>(DEFAULT_THEME_MODE);
    permissionGranted = signal(false);
    extensionConnected = signal(false);
    features = signal<CompanionFeatures>(DEFAULT_FEATURES);
    appVisibilityMode = signal<AppVisibilityMode>(DEFAULT_APP_VISIBILITY_MODE);
    currentBinding = signal<PttBinding>({ code: 0, modifiers: [] });
    isForcingRelease = false;
    logs = signal.Array<LogEntry>([]);
    showSettings = signal(false);
    hasCallTab = signal(false);
    callStateKnown = signal(false);
    isMute = signal(false);
    isDeaf = signal(false);
    isCameraOn = signal(false);
    isScreenOn = signal(false);

    // WS Port Management
    wsPort = signal(DEFAULT_PORT);
    isWsReloading = signal(false);

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
        const storedMode = this.getStoredThemeMode();
        this.themeMode.set(storedMode);
        this.applyThemeMode(storedMode);
    }

    getStoredThemeMode(): ThemeMode {
        if (typeof window === "undefined") {
            return DEFAULT_THEME_MODE;
        }
        try {
            const mode = window.localStorage.getItem(THEME_STORAGE_KEY);
            if (mode === THEME_MODE.Dark || mode === THEME_MODE.Light) {
                return mode;
            }
        } catch {
            // Keep default theme when storage is unavailable.
        }
        return DEFAULT_THEME_MODE;
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
        const isConnected = await invoke<boolean>("is_extension_connected");
        this.extensionConnected.set(isConnected);

        const bindingCapturedUnlisten = await listen<BindingCapturedPayload>(
            "binding-captured",
            async (event) => {
                if (!this.isRecording()) {
                    return;
                }
                await this.applyRecordedBinding(event.payload.key);
            }
        );

        await setupChannel(async (event: ChannelEvent) => {
            switch (event.type) {
                case ChannelEventType.PttEvent: {
                    const payload = event.payload as {
                        type: string;
                        ts: number;
                        key: { code: number; modifiers: number[] };
                        is_repeat: boolean;
                    };
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
                    this.addLog("ERROR", event.payload as string);
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
                    const payload = event.payload as CallStatePayload;
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
        await setRecordingMode(false);
        await updateBinding(binding.code, binding.modifiers);
        this.currentBinding.set(binding);
        this.addLog(
            "SYSTEM",
            `Key binding updated to: ${this.formatKeyBinding(binding.code, binding.modifiers)}`
        );
    }

    async fetchFeatures() {
        try {
            const features = await invoke<CompanionFeatures>(FEATURES_COMMAND);
            if (features) {
                this.features.set(features);
            }
        } catch (error) {
            this.features.set(DEFAULT_FEATURES);
            this.addLog("ERROR", `Failed to load features: ${String(error)}`);
        }
    }

    async fetchAppVisibilityMode() {
        try {
            const mode = await invoke<AppVisibilityMode>(APP_VISIBILITY_COMMAND_GET);
            if (mode) {
                this.appVisibilityMode.set(mode);
            }
        } catch (error) {
            this.appVisibilityMode.set(DEFAULT_APP_VISIBILITY_MODE);
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
            await invoke(APP_VISIBILITY_COMMAND_SET, { mode });
            this.addLog("SYSTEM", `App visibility set to ${mode}`);
        } catch (error) {
            this.appVisibilityMode.set(previous);
            this.addLog("ERROR", `Failed to update app visibility: ${String(error)}`);
        }
    }

    async checkPermission() {
        const isGranted = await invoke<boolean>("is_accessibility_granted");
        this.permissionGranted.set(isGranted);
    }

    async fetchCurrentBinding() {
        const binding = await invoke<PttBinding>("get_current_binding");
        if (binding) {
            this.currentBinding.set(binding);
        }
    }

    async fetchWsPort() {
        const port = await invoke<number>("get_ws_port");
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
            const currentPort = await invoke<number>("get_ws_port");
            if (port === currentPort) {
                this.addLog("SYSTEM", "Port unchanged, skipping reload");
                return;
            }

            this.addLog("SYSTEM", `Initiating WS server reload to port: ${port}`);
            this.isWsReloading.set(true);
            await updateWsPort(port);
            this.addLog("SYSTEM", "Reload command sent to backend");
        } catch (e) {
            this.addLog("ERROR", `Failed to reload WS server: ${e}`);
            this.isWsReloading.set(false);
        }
    }

    async toggleRecording() {
        if (this.isRecording()) {
            this.isRecording.set(false);
            await setRecordingMode(false);
            await this.fetchCurrentBinding();
        } else {
            this.isRecording.set(true);
            await setRecordingMode(true);
        }
    }

    async forceRelease() {
        this.addLog("SYSTEM", "Safety release triggered");
        this.isForcingRelease = true;
        this.isPressed.set(false);
        await invoke("force_ptt_up");
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

    async runCallCommand(command: CallCommand, value?: boolean, label?: string) {
        const didSend = await sendCallCommand(command, value);
        if (!didSend) {
            this.addLog("CALL", "Failed to reach extension");
            return false;
        }
        if (value === undefined) {
            this.addLog("CALL", label ? `Sent ${label}` : `Sent ${command}`);
        } else {
            this.addLog("CALL", label ? `Sent ${label}: ${value}` : `Sent ${command}: ${value}`);
        }
        return true;
    }

    async toggleMute() {
        if (!this.canUseCallToggles()) {
            return;
        }
        await this.runCallCommand(CallCommand.SetMute, !this.isMute(), "Mute");
    }

    async toggleDeafen() {
        if (!this.canUseCallToggles()) {
            return;
        }
        await this.runCallCommand(CallCommand.SetDeaf, !this.isDeaf(), "Deafen");
    }

    async toggleCamera() {
        if (!this.canUseCallToggles()) {
            return;
        }
        await this.runCallCommand(CallCommand.SetCamera, !this.isCameraOn(), "Camera");
    }

    async toggleScreen() {
        if (!this.canUseCallToggles()) {
            return;
        }
        await this.runCallCommand(CallCommand.SetScreen, !this.isScreenOn(), "Screen");
    }

    async openPip() {
        if (!this.hasActiveCall()) {
            return;
        }
        await this.runCallCommand(CallCommand.OpenPip, undefined, "Open PiP");
    }

    async leaveCall() {
        if (!this.hasActiveCall()) {
            return;
        }
        await this.runCallCommand(CallCommand.LeaveCall, undefined, "Leave call");
    }

    async goToCall() {
        if (!this.hasActiveCall()) {
            return;
        }
        await this.runCallCommand(CallCommand.FocusCallTab, undefined, "Go to call");
    }

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
        await invoke("show_main_window");
    }

    async quitApp() {
        await invoke("quit_app");
    }
}
