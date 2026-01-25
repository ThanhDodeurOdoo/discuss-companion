import { Plugin, signal, onWillDestroy } from "@odoo/owl";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { KEY_MAP, KEY_SYMBOL_MAP, MODIFIER_SYMBOLS } from "./utils";

type LogEntry = {
    id: number;
    ts: string;
    type: string;
    message: string;
};

type PttEvent = {
    type: string;
    ts: number;
    key: {
        code: number;
        modifiers: string[];
    };
    is_repeat?: boolean;
};

type PttBinding = {
    code: number;
    modifiers: string[];
};

const MAX_LOGS = 20;
const MODIFIER_ORDER: Record<string, number> = { Cmd: 0, Ctrl: 1, Option: 2, Shift: 3 };

export class AppPlugin extends Plugin {
    static id = "AppPlugin";

    isRecording = signal(false);
    isPressed = signal(false);
    showSymbols = signal(true);
    permissionGranted = signal(false);
    extensionConnected = signal(false);
    currentBinding = signal<PttBinding>({ code: 0, modifiers: [] });
    isForcingRelease = false;
    logs = signal.Array<LogEntry>([]);

    // WS Port Management
    wsPort = signal(49152);
    isWsReloading = signal(false);

    logIdCounter = 0;
    unlistenFns: (() => void)[] = [];
    permissionInterval: number | null = null;

    setup() {
        this.init();
        this.permissionInterval = window.setInterval(() => this.checkPermission(), 2000);

        onWillDestroy(() => {
            this.unlistenFns.forEach((fn) => fn());
            if (this.permissionInterval) {
                clearInterval(this.permissionInterval);
            }
        });
    }

    async init() {
        this.addLog("SYSTEM", "Ready");
        await this.fetchCurrentBinding();
        await this.fetchWsPort();
        await this.checkPermission();
        await this.setupListeners();
    }

    async setupListeners() {
        const isConnected = await invoke<boolean>("is_extension_connected");
        this.extensionConnected.set(isConnected);

        const pttUnlisten = await listen<PttEvent>("ptt-event", async (event) => {
            const payload = event.payload;

            if (this.isRecording()) {
                this.isRecording.set(false);
                await invoke("set_recording_mode", { recording: false });
                await invoke("update_binding", {
                    binding: {
                        code: payload.key.code,
                        modifiers: payload.key.modifiers
                    }
                });
                this.currentBinding.set({
                    code: payload.key.code,
                    modifiers: payload.key.modifiers
                });
                this.addLog(
                    "SYSTEM",
                    `Key binding updated to: ${this.formatKeyBinding(
                        payload.key.code,
                        payload.key.modifiers
                    )}`
                );
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
        });

        const errorUnlisten = await listen("error", (event) => {
            this.addLog("ERROR", event.payload as string);
        });

        const wsConnectUnlisten = await listen("ws-connection", (event) => {
            this.extensionConnected.set(true);
            this.addLog("WS", event.payload as string);
        });

        const wsDisconnectUnlisten = await listen("ws-disconnection", (event) => {
            this.extensionConnected.set(false);
            this.addLog("WS", event.payload as string);
        });

        const wsMsgUnlisten = await listen("ws-message", (event) => {
            this.addLog("WS-MSG", JSON.stringify(event.payload));
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

        this.unlistenFns.push(
            pttUnlisten,
            errorUnlisten,
            wsConnectUnlisten,
            wsDisconnectUnlisten,
            wsMsgUnlisten,
            wsStatusUnlisten
        );
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
            await invoke("update_ws_port", { port });
            this.addLog("SYSTEM", "Reload command sent to backend");
        } catch (e) {
            this.addLog("ERROR", `Failed to reload WS server: ${e}`);
            this.isWsReloading.set(false);
        }
    }

    async toggleRecording() {
        if (this.isRecording()) {
            this.isRecording.set(false);
            await invoke("set_recording_mode", { recording: false });
            await this.fetchCurrentBinding();
        } else {
            this.isRecording.set(true);
            await invoke("set_recording_mode", { recording: true });
        }
    }

    async forceRelease() {
        this.addLog("SYSTEM", "Safety release triggered");
        this.isForcingRelease = true;
        this.isPressed.set(false);
        await invoke("force_ptt_up");
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

    formatKeyBinding(code: number, modifiers: string[] = []): string {
        const keyName = KEY_MAP[code] || `Key ${code}`;
        const formattedModifiers = modifiers
            .map((m) => {
                switch (m) {
                    case "meta":
                        return "Cmd";
                    case "alt":
                        return "Option";
                    case "ctrl":
                        return "Ctrl";
                    case "shift":
                        return "Shift";
                    default:
                        return m;
                }
            })
            .sort((a, b) => (MODIFIER_ORDER[a] ?? 99) - (MODIFIER_ORDER[b] ?? 99));

        if (formattedModifiers.length > 0) {
            return `${formattedModifiers.join("+")}+${keyName}`;
        }
        return keyName;
    }

    formatKeySymbol(code: number, modifiers: string[] = []): string {
        const keySymbol = KEY_SYMBOL_MAP[code] || KEY_MAP[code] || "";
        const formattedModifiers = modifiers
            .map((m) => MODIFIER_SYMBOLS[m] || "")
            .filter((s) => s !== "")
            .sort((a, b) => (MODIFIER_ORDER[a] ?? 99) - (MODIFIER_ORDER[b] ?? 99));

        return `${formattedModifiers.join("")}${keySymbol}`;
    }
}
