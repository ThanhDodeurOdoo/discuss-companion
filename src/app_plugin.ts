import { Plugin, signal, onWillDestroy } from "@odoo/owl";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface LogEntry {
    id: number;
    ts: string;
    type: string;
    message: string;
}

interface PttEvent {
    type: string;
    ts: number;
    key: {
        code: number;
        modifiers: string[];
    };
    is_repeat?: boolean;
}

interface PttBinding {
    code: number;
    modifiers: string[];
}

export class AppPlugin extends Plugin {
    static id = "AppPlugin";

    isRecording = signal(false);
    permissionGranted = signal(false);
    extensionConnected = signal(false);
    currentBindingCode = signal(0);
    logs = signal.Array<LogEntry>([]);

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
        this.addLog("SYSTEM", "Agent UI initialized. Listening for events...");
        await this.fetchCurrentBinding();
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
                        modifiers: []
                    }
                });
                this.currentBindingCode.set(payload.key.code);
                this.addLog(
                    "SYSTEM",
                    `Key binding updated to: ${this.getKeyName(payload.key.code)}`
                );
                return;
            }

            if (payload.type === "ptt_down" && payload.is_repeat) {
                return;
            }

            const type = payload.type === "ptt_down" ? "DOWN" : "UP";
            this.addLog(type, `Key: ${this.getKeyName(payload.key.code)}`);
            this.currentBindingCode.set(payload.key.code);
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

        this.unlistenFns.push(
            pttUnlisten,
            errorUnlisten,
            wsConnectUnlisten,
            wsDisconnectUnlisten,
            wsMsgUnlisten
        );
    }

    async checkPermission() {
        const isGranted = await invoke<boolean>("is_accessibility_granted");
        this.permissionGranted.set(isGranted);
    }

    async fetchCurrentBinding() {
        const binding = await invoke<PttBinding>("get_current_binding");
        if (binding && binding.code) {
            this.currentBindingCode.set(binding.code);
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

    addLog(type: string, message: string) {
        const time = new Date().toLocaleTimeString("en-US", {
            hour12: false
        });

        // signal.Array proxy allows direct mutation which triggers reactivity
        this.logs().unshift({
            id: ++this.logIdCounter,
            ts: time,
            type,
            message
        });

        if (this.logs().length > 10) {
            this.logs().pop();
        }
    }

    clearLogs() {
        this.logs.set([]);
    }

    getKeyName(code: number): string {
        const keyMap: Record<number, string> = {
            49: "Space",
            56: "Shift",
            59: "Ctrl",
            58: "Option",
            55: "Command",
            123: "Left",
            124: "Right",
            125: "Down",
            126: "Up",
            36: "Enter",
            48: "Tab",
            51: "Backspace",
            53: "Escape",
            71: "Clear",
            0: "A",
            11: "B",
            8: "C",
            2: "D",
            14: "E",
            3: "F",
            5: "G",
            4: "H",
            34: "I",
            38: "J",
            40: "K",
            37: "L",
            46: "M",
            45: "N",
            31: "O",
            35: "P",
            12: "Q",
            15: "R",
            1: "S",
            17: "T",
            32: "U",
            9: "V",
            13: "W",
            7: "X",
            16: "Y",
            6: "Z",
            29: "0",
            18: "1",
            19: "2",
            20: "3",
            21: "4",
            23: "5",
            22: "6",
            26: "7",
            28: "8",
            213: "9",
            10: "§",
            50: "`",
            27: "-",
            24: "=",
            33: "[",
            30: "]",
            42: "\\",
            41: ";",
            39: "'",
            43: ",",
            47: ".",
            44: "/"
        };
        return keyMap[code] || `Key ${code}`;
    }
}
