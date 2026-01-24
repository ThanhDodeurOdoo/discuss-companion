import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface PttEvent {
    type: string;
    ts: number;
    key: {
        code: number;
        modifiers: string[];
    };
    is_repeat?: boolean;
}

const logContainer = document.querySelector("#log-container") as HTMLElement;
const clearLogsBtn = document.querySelector("#clear-logs") as HTMLButtonElement;
const pttKeyDisplay = document.querySelector("#ptt-key-display") as HTMLElement;
const updateKeyBtn = document.querySelector("#update-key-btn") as HTMLButtonElement;
const permissionStatus = document.querySelector("#permission-status") as HTMLElement;
const extensionStatus = document.querySelector("#extension-status") as HTMLElement;

let isRecording = false;

async function checkPermission() {
    const isGranted = await invoke<boolean>("is_accessibility_granted");
    if (isGranted) {
        permissionStatus.style.background = "rgba(35, 134, 54, 0.1)";
        permissionStatus.style.borderColor = "#238636";
        permissionStatus.style.color = "#238636";
        permissionStatus.innerHTML = `
            <div class="status-dot" style="background: #238636; box-shadow: 0 0 10px #238636;"></div>
            Accessibility Granted
        `;
    }
}

function addLog(type: string, message: string) {
    const entry = document.createElement("div");
    entry.className = "log-entry";

    const time = new Date().toLocaleTimeString("en-US", {
        hour12: false,
        fractionDigits: 3
    } as Intl.DateTimeFormatOptions);
    const typeClass = type.toLowerCase().includes("down")
        ? "type-down"
        : type.toLowerCase().includes("error")
        ? "type-error"
        : "type-up";

    entry.innerHTML = `
        <span class="log-ts">${time}</span>
        <span class="log-type ${typeClass}">${type}</span>
        <span class="log-msg">${message}</span>
    `;

    logContainer.prepend(entry);

    // Keep only last 10 entries
    while (logContainer.children.length > 10) {
        logContainer.lastElementChild?.remove();
    }
}

interface PttBinding {
    code: number;
    modifiers: string[];
}

async function fetchCurrentBinding() {
    const binding = await invoke<PttBinding>("get_current_binding");
    if (binding && binding.code) {
        updateKeyDisplay(binding.code);
    }
}

function getKeyName(code: number): string {
    const keyMap: Record<number, string> = {
        // Special keys
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

        // Alphanumeric
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
        25: "9",

        // Punctuation
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

function updateKeyDisplay(code: number) {
    pttKeyDisplay.textContent = getKeyName(code);
}

listen("ptt-event", async (event) => {
    const payload = event.payload as PttEvent;

    if (isRecording) {
        isRecording = false;
        pttKeyDisplay.classList.remove("recording");
        updateKeyBtn.textContent = "Change Key";
        updateKeyBtn.style.background = "var(--accent-color)";

        await invoke("set_recording_mode", { recording: false });
        await invoke("update_binding", {
            binding: {
                code: payload.key.code,
                modifiers: []
            }
        });
        updateKeyDisplay(payload.key.code);
        addLog("SYSTEM", `Key binding updated to: ${getKeyName(payload.key.code)}`);
        return;
    }

    // Skip repeat logs in UI
    if (payload.type === "ptt_down" && payload.is_repeat) {
        return;
    }

    const type = payload.type === "ptt_down" ? "DOWN" : "UP";
    const msg = `Key: ${getKeyName(payload.key.code)}`;
    addLog(type, msg);
    updateKeyDisplay(payload.key.code);
});

listen("error", (event) => {
    addLog("ERROR", event.payload as string);
});

listen("ws-connection", (event) => {
    const msg = event.payload as string;
    addLog("WS", msg);

    extensionStatus.style.background = "var(--accent-glow)";
    extensionStatus.style.borderColor = "var(--accent-color)";
    extensionStatus.style.color = "var(--accent-color)";
    extensionStatus.innerHTML = `
        <div class="status-dot" style="background: var(--accent-color); box-shadow: 0 0 10px var(--accent-color); animation: pulse 2s infinite;"></div>
        Ext. Connected
    `;
});

listen("ws-disconnection", (event) => {
    const msg = event.payload as string;
    addLog("WS", msg);

    extensionStatus.style.background = "rgba(139, 148, 158, 0.15)";
    extensionStatus.style.borderColor = "var(--border-color)";
    extensionStatus.style.color = "var(--text-secondary)";
    extensionStatus.innerHTML = `
        <div class="status-dot" style="background: var(--text-secondary); box-shadow: none; animation: none;"></div>
        Ext. Disconnected
    `;
});

listen("ws-message", (event) => {
    // Assuming the payload is the message object or string
    const payload = event.payload;
    addLog("WS-MSG", JSON.stringify(payload));
});

updateKeyBtn.addEventListener("click", () => {
    if (isRecording) {
        isRecording = false;
        pttKeyDisplay.classList.remove("recording");
        updateKeyBtn.textContent = "Change Key";
        updateKeyBtn.style.background = "var(--accent-color)";
        invoke("set_recording_mode", { recording: false });
        fetchCurrentBinding();
    } else {
        isRecording = true;
        pttKeyDisplay.classList.add("recording");
        pttKeyDisplay.textContent = "PRESS ANY KEY...";
        updateKeyBtn.textContent = "Cancel";
        updateKeyBtn.style.background = "var(--error)";
        invoke("set_recording_mode", { recording: true });
    }
});

clearLogsBtn.addEventListener("click", () => {
    logContainer.innerHTML = "";
});

// Initial log
addLog("SYSTEM", "Agent UI initialized. Listening for events...");

// Initial state
fetchCurrentBinding();
checkPermission();
setInterval(checkPermission, 2000);
