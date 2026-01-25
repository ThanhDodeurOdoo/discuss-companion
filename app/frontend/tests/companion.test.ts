import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { App as OwlApp } from "@odoo/owl";

// Mock Tauri APIs
const invokeMock = jest.fn();
const listenMock = jest.fn(() => Promise.resolve(() => {}));

jest.unstable_mockModule("@tauri-apps/api/core", () => ({
    invoke: invokeMock
}));

jest.unstable_mockModule("@tauri-apps/api/event", () => ({
    listen: listenMock
}));

const { Root } = await import("../root");

describe("Companion Component Interactions", () => {
    let target: HTMLElement;
    let owlApp: OwlApp;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
        invokeMock.mockClear();
        listenMock.mockClear();

        // Default mock implementations
        invokeMock.mockImplementation((cmd) => {
            if (cmd === "is_extension_connected") {
                return Promise.resolve(false);
            }
            if (cmd === "get_current_binding") {
                return Promise.resolve({ code: 0, modifiers: [] });
            }
            if (cmd === "get_ws_port") {
                return Promise.resolve(49152);
            }
            if (cmd === "is_accessibility_granted") {
                return Promise.resolve(true);
            }
            return Promise.resolve(null);
        });
    });

    afterEach(() => {
        if (owlApp) {
            owlApp.destroy();
        }
        document.body.removeChild(target);
    });

    async function mountApp() {
        const { AppPlugin } = await import("../app_plugin");
        owlApp = new OwlApp({ plugins: [AppPlugin] });
        await owlApp.createRoot(Root).mount(target);
    }

    test("PTT Button toggles recording mode", async () => {
        await mountApp();

        const pttBtn = target.querySelector(".key-display") as HTMLButtonElement;
        expect(pttBtn).toBeTruthy();

        // Initial state: not recording
        expect(pttBtn.classList.contains("recording")).toBe(false);

        // Click to start recording
        await pttBtn.click();
        expect(invokeMock).toHaveBeenCalledWith("set_recording_mode", { recording: true });

        // Let's verify the subsequent call
        await pttBtn.click();
        expect(invokeMock).toHaveBeenCalledWith("set_recording_mode", { recording: false });
    });

    test("Force Release button triggers force_ptt_up", async () => {
        await mountApp();
        const forceBtn = target.querySelector(".safety-btn") as HTMLButtonElement;
        expect(forceBtn).toBeTruthy();
        expect(forceBtn.textContent).toContain("force release");

        await forceBtn.click();
        expect(invokeMock).toHaveBeenCalledWith("force_ptt_up");
    });

    test("Reload WS button triggers update_ws_port", async () => {
        await mountApp();
        const reloadBtn = target.querySelector(".reload-btn") as HTMLButtonElement;
        const portInput = target.querySelector("#ws-port") as HTMLInputElement;

        expect(reloadBtn).toBeTruthy();
        expect(portInput).toBeTruthy();

        // Change the port value
        // We need to trigger the input event for Owl to update the bound value
        portInput.value = "55555";
        portInput.dispatchEvent(new Event("input"));

        await reloadBtn.click();
        expect(invokeMock).toHaveBeenCalledWith("update_ws_port", { port: 55555 });
    });
});
