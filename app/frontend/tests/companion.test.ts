import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { App as OwlApp } from "@odoo/owl";

// Mock Tauri APIs
const invokeMock = jest.fn();
const listenMock = jest.fn(() => Promise.resolve(() => {}));
const setRecordingModeMock = jest.fn();
const updateBindingMock = jest.fn();
const updateWsPortMock = jest.fn();
const setupChannelMock = jest.fn();
const sendCallCommandMock = jest.fn();
const ChannelMock = jest.fn();

jest.unstable_mockModule("@tauri-apps/api/core", () => ({
    invoke: invokeMock,
    Channel: ChannelMock
}));

jest.unstable_mockModule("@tauri-apps/api/event", () => ({
    listen: listenMock
}));

jest.unstable_mockModule("../ipc", () => ({
    setRecordingMode: setRecordingModeMock,
    updateBinding: updateBindingMock,
    updateWsPort: updateWsPortMock,
    setupChannel: setupChannelMock,
    sendCallCommand: sendCallCommandMock
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
        setRecordingModeMock.mockClear();
        updateBindingMock.mockClear();
        updateWsPortMock.mockClear();
        setupChannelMock.mockClear();
        sendCallCommandMock.mockClear();
        ChannelMock.mockClear();

        // Default mock implementations
        invokeMock.mockImplementation((cmd) => {
            if (cmd === "get_features") {
                return Promise.resolve({ ptt: true, callControlsTray: true });
            }
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
        expect(setRecordingModeMock).toHaveBeenCalledWith(true);

        // Let's verify the subsequent call
        await pttBtn.click();
        expect(setRecordingModeMock).toHaveBeenCalledWith(false);
    });

    test("PTT UI is hidden when feature is disabled", async () => {
        invokeMock.mockImplementation((cmd) => {
            if (cmd === "get_features") {
                return Promise.resolve({ ptt: false, callControlsTray: false });
            }
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

        await mountApp();

        const pttBtn = target.querySelector(".key-display");
        expect(pttBtn).toBeNull();

        const forceBtn = target.querySelector(".safety-btn");
        expect(forceBtn).toBeNull();
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

        // Navigate to settings page
        const settingsBtn = target.querySelector(".settings-btn") as HTMLButtonElement;
        expect(settingsBtn).toBeTruthy();
        await settingsBtn.click();
        await new Promise((resolve) => setTimeout(resolve, 50));

        const reloadBtn = target.querySelector(".reload-btn") as HTMLButtonElement;
        const portInput = target.querySelector("#ws-port") as HTMLInputElement;

        expect(reloadBtn).toBeTruthy();
        expect(portInput).toBeTruthy();

        // Change the port value
        // We need to trigger the input event for Owl to update the bound value
        portInput.value = "55555";
        portInput.dispatchEvent(new Event("input"));

        await reloadBtn.click();
        expect(updateWsPortMock).toHaveBeenCalledWith(55555);
    });
});
