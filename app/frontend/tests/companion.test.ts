import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { cleanupOwl, render, screen, userEvent } from "@root/tests/utils/owl_test_utils";
import type { CallStatePayload, ChannelEvent } from "../ipc_types";

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
const { CallCommand } = await import("../call_commands");
const { ChannelEventType } = await import("../ipc_types");

const DEFAULT_FEATURES = { ptt: true, callControlsTray: true };
const IN_CALL_STATE: CallStatePayload = {
    hasCall: true,
    hasState: true,
    isMute: false,
    isDeaf: false,
    isCameraOn: false,
    isScreenOn: false
};

function mockInvokeDefaults({
    features = DEFAULT_FEATURES,
    extensionConnected = false
}: {
    features?: { ptt: boolean; callControlsTray: boolean };
    extensionConnected?: boolean;
} = {}) {
    invokeMock.mockImplementation((cmd) => {
        if (cmd === "get_features") {
            return Promise.resolve(features);
        }
        if (cmd === "get_app_visibility_mode") {
            return Promise.resolve("trayAndDockWhenWindowOpen");
        }
        if (cmd === "is_extension_connected") {
            return Promise.resolve(extensionConnected);
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
}

function mockCallState(state: CallStatePayload) {
    setupChannelMock.mockImplementation(async (onEvent) => {
        const dispatch = onEvent as (event: ChannelEvent) => void | Promise<void>;
        await dispatch({
            type: ChannelEventType.CallState,
            payload: state
        });
    });
}

describe("Companion Component Interactions", () => {
    let target: HTMLElement;

    beforeEach(() => {
        invokeMock.mockClear();
        listenMock.mockClear();
        setRecordingModeMock.mockClear();
        updateBindingMock.mockClear();
        updateWsPortMock.mockClear();
        setupChannelMock.mockClear();
        sendCallCommandMock.mockClear();
        ChannelMock.mockClear();
        setupChannelMock.mockImplementation(async () => {});
        sendCallCommandMock.mockImplementation(async () => true);
        mockInvokeDefaults();
    });

    afterEach(() => {
        cleanupOwl();
    });

    async function mountApp() {
        const { AppPlugin } = await import("../app_plugin");
        const mounted = await render(Root, {
            appConfig: { plugins: [AppPlugin] }
        });
        target = mounted.target;
    }

    test("PTT Button toggles recording mode", async () => {
        await mountApp();

        const pttBtn = screen.getByRole("button", { name: /ptt/i }) as HTMLButtonElement;
        expect(pttBtn).toBeTruthy();

        expect(pttBtn.classList.contains("recording")).toBe(false);

        await userEvent.click(pttBtn);
        expect(setRecordingModeMock).toHaveBeenCalledWith(true);

        await userEvent.click(pttBtn);
        expect(setRecordingModeMock).toHaveBeenCalledWith(false);
    });

    test("PTT UI is hidden when feature is disabled", async () => {
        mockInvokeDefaults({
            features: { ptt: false, callControlsTray: false }
        });

        await mountApp();

        const pttBtn = target.querySelector(".key-display");
        expect(pttBtn).toBeNull();

        const forceBtn = target.querySelector(".safety-btn");
        expect(forceBtn).toBeNull();
    });

    test("Force Release button triggers force_ptt_up", async () => {
        await mountApp();
        const forceBtn = screen.getByRole("button", {
            name: /force release/i
        }) as HTMLButtonElement;
        expect(forceBtn).toBeTruthy();

        await userEvent.click(forceBtn);
        expect(invokeMock).toHaveBeenCalledWith("force_ptt_up");
    });

    test("Call controls send commands when call is active", async () => {
        mockInvokeDefaults({ extensionConnected: true });
        mockCallState(IN_CALL_STATE);

        await mountApp();

        const muteBtn = target.querySelector('button[title="Mute"]') as HTMLButtonElement;
        const deafenBtn = target.querySelector('button[title="Deafen"]') as HTMLButtonElement;
        const cameraBtn = target.querySelector(
            'button[title="Turn camera on"]'
        ) as HTMLButtonElement;
        const screenBtn = target.querySelector('button[title="Share screen"]') as HTMLButtonElement;
        const leaveBtn = target.querySelector('button[title="Leave call"]') as HTMLButtonElement;
        const goToCallBtn = screen.getByRole("button", {
            name: /go to call/i
        }) as HTMLButtonElement;

        expect(target.querySelector(".call-inactive")).toBeNull();
        expect(muteBtn.disabled).toBe(false);
        expect(deafenBtn.disabled).toBe(false);
        expect(cameraBtn.disabled).toBe(false);
        expect(screenBtn.disabled).toBe(false);
        expect(leaveBtn.disabled).toBe(false);

        await userEvent.click(muteBtn);
        await userEvent.click(deafenBtn);
        await userEvent.click(cameraBtn);
        await userEvent.click(screenBtn);
        await userEvent.click(goToCallBtn);
        await userEvent.click(leaveBtn);

        expect(sendCallCommandMock).toHaveBeenNthCalledWith(1, CallCommand.SetMute, true);
        expect(sendCallCommandMock).toHaveBeenNthCalledWith(2, CallCommand.SetDeaf, true);
        expect(sendCallCommandMock).toHaveBeenNthCalledWith(3, CallCommand.SetCamera, true);
        expect(sendCallCommandMock).toHaveBeenNthCalledWith(4, CallCommand.SetScreen, true);
        expect(sendCallCommandMock).toHaveBeenNthCalledWith(5, CallCommand.FocusCallTab, undefined);
        expect(sendCallCommandMock).toHaveBeenNthCalledWith(6, CallCommand.LeaveCall, undefined);
    });

    test("Call controls stay disabled while call state is syncing", async () => {
        mockInvokeDefaults({ extensionConnected: true });
        mockCallState({
            ...IN_CALL_STATE,
            hasState: false
        });

        await mountApp();

        const callStatus = target.querySelector(".call-status") as HTMLSpanElement;
        const muteBtn = target.querySelector('button[title="Mute"]') as HTMLButtonElement;
        const leaveBtn = target.querySelector('button[title="Leave call"]') as HTMLButtonElement;

        expect(callStatus.textContent).toBe("Syncing call state...");
        expect(muteBtn.disabled).toBe(true);
        expect(leaveBtn.disabled).toBe(true);

        await userEvent.click(muteBtn);
        expect(sendCallCommandMock).not.toHaveBeenCalled();
    });

    test("Reload WS button triggers update_ws_port", async () => {
        await mountApp();

        // Navigate to settings page
        const settingsBtn = screen.getByRole("button", { name: /settings/i }) as HTMLButtonElement;
        expect(settingsBtn).toBeTruthy();
        await userEvent.click(settingsBtn);

        const reloadBtn = target.querySelector(".reload-btn") as HTMLButtonElement;
        const portInput = target.querySelector("#ws-port") as HTMLInputElement;

        expect(reloadBtn).toBeTruthy();
        expect(portInput).toBeTruthy();

        // Change the port value
        // We need to trigger the input event for Owl to update the bound value
        portInput.value = "55555";
        portInput.dispatchEvent(new Event("input"));

        await userEvent.click(reloadBtn);
        expect(updateWsPortMock).toHaveBeenCalledWith(55555);
    });
});
