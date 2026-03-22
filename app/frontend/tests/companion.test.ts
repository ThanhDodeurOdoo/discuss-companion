import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import {
    cleanupOwl,
    render,
    screen,
    userEvent,
    updateInput
} from "@root/tests/utils/owl_test_utils";
import { IPC_COMMAND, type ChannelEvent, type CallStatePayload } from "../ipc_types";

const invokeMock = jest.fn();
const listenMock = jest.fn(() => Promise.resolve(() => {}));
const setupChannelMock = jest.fn();

jest.unstable_mockModule("@tauri-apps/api/core", () => ({
    invoke: invokeMock,
    Channel: jest.fn()
}));

jest.unstable_mockModule("@tauri-apps/api/event", () => ({
    listen: listenMock
}));

jest.unstable_mockModule("../ipc", () => {
    return {
        setRecordingMode: () => invokeMock(IPC_COMMAND.SetRecordingMode),
        updateBinding: () => invokeMock(IPC_COMMAND.UpdateBinding),
        updateWsPort: () => invokeMock(IPC_COMMAND.UpdateWsPort),
        getFeatures: () => invokeMock(IPC_COMMAND.GetFeatures),
        getAppVisibilityMode: () => invokeMock(IPC_COMMAND.GetAppVisibilityMode),
        setAppVisibilityMode: (mode: string) =>
            invokeMock(IPC_COMMAND.SetAppVisibilityMode, { mode }),
        isAccessibilityGranted: () => invokeMock(IPC_COMMAND.IsAccessibilityGranted),
        isExtensionConnected: () => invokeMock(IPC_COMMAND.IsExtensionConnected),
        getCurrentBinding: () => invokeMock(IPC_COMMAND.GetCurrentBinding),
        getWsPort: () => invokeMock(IPC_COMMAND.GetWsPort),
        forcePttUp: () => invokeMock(IPC_COMMAND.ForcePttUp),
        showMainWindow: () => invokeMock(IPC_COMMAND.ShowMainWindow),
        quitApp: () => invokeMock(IPC_COMMAND.QuitApp),
        setMute: (v: boolean) =>
            invokeMock(IPC_COMMAND.SendCallCommand, { command: "set-mute", value: v }),
        setDeaf: (v: boolean) =>
            invokeMock(IPC_COMMAND.SendCallCommand, { command: "set-deaf", value: v }),
        setCamera: (v: boolean) =>
            invokeMock(IPC_COMMAND.SendCallCommand, { command: "set-camera", value: v }),
        setScreen: (v: boolean) =>
            invokeMock(IPC_COMMAND.SendCallCommand, { command: "set-screen", value: v }),
        openPip: () =>
            invokeMock(IPC_COMMAND.SendCallCommand, { command: "open-pip", value: undefined }),
        leaveCall: () =>
            invokeMock(IPC_COMMAND.SendCallCommand, { command: "leave-call", value: undefined }),
        focusCallTab: () =>
            invokeMock(IPC_COMMAND.SendCallCommand, {
                command: "focus-call-tab",
                value: undefined
            }),
        setupChannel: setupChannelMock
    };
});

const { Root } = await import("../root");
const { ChannelEventType } = await import("../ipc_types");

const IN_CALL_STATE: CallStatePayload = {
    hasCall: true,
    hasState: true,
    isMute: false,
    isDeaf: false,
    isCameraOn: false,
    isScreenOn: false
};

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

    let mockState: {
        features: { ptt: boolean; callControlsTray: boolean };
        appVisibilityMode: string;
        extensionConnected: boolean;
        currentBinding: { code: number; modifiers: number[] };
        wsPort: number;
        accessibilityGranted: boolean;
    };

    beforeEach(() => {
        jest.clearAllMocks();
        setupChannelMock.mockImplementation(async () => {});

        mockState = {
            features: { ptt: true, callControlsTray: true },
            appVisibilityMode: "trayAndDockWhenWindowOpen",
            extensionConnected: false,
            currentBinding: { code: 0, modifiers: [] },
            wsPort: 49152,
            accessibilityGranted: true
        };

        invokeMock.mockImplementation((cmd) => {
            switch (cmd) {
                case IPC_COMMAND.GetFeatures:
                    return Promise.resolve(mockState.features);
                case IPC_COMMAND.GetAppVisibilityMode:
                    return Promise.resolve(mockState.appVisibilityMode);
                case IPC_COMMAND.IsExtensionConnected:
                    return Promise.resolve(mockState.extensionConnected);
                case IPC_COMMAND.GetCurrentBinding:
                    return Promise.resolve(mockState.currentBinding);
                case IPC_COMMAND.GetWsPort:
                    return Promise.resolve(mockState.wsPort);
                case IPC_COMMAND.IsAccessibilityGranted:
                    return Promise.resolve(mockState.accessibilityGranted);
                case IPC_COMMAND.SendCallCommand:
                    return Promise.resolve(true);
                default:
                    return Promise.resolve(null);
            }
        });
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
        expect(pttBtn.classList.contains("recording")).toBe(false);

        await userEvent.click(pttBtn);
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.SetRecordingMode);

        await userEvent.click(pttBtn);
        const recordingCalls = invokeMock.mock.calls.filter(
            ([cmd]) => cmd === IPC_COMMAND.SetRecordingMode
        );
        expect(recordingCalls).toHaveLength(2);
    });

    test("header keeps only the extension dot when permission is granted", async () => {
        await mountApp();

        const connectionIndicator = target.querySelector(
            ".header-connection-indicator"
        ) as HTMLSpanElement;

        expect(connectionIndicator.title).toBe("Extension disconnected");
        expect(target.querySelector(".status-item")).toBeNull();
    });

    test("PTT UI is hidden when feature is disabled", async () => {
        mockState.features = { ptt: false, callControlsTray: false };
        await mountApp();

        expect(target.querySelector(".key-display")).toBeNull();
        expect(target.querySelector(".safety-btn")).toBeNull();
    });

    test("Force Release button triggers force_ptt_up", async () => {
        await mountApp();

        const forceBtn = screen.getByRole("button", {
            name: /force release/i
        }) as HTMLButtonElement;
        await userEvent.click(forceBtn);
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.ForcePttUp);
    });

    test("Call controls send commands when call is active", async () => {
        mockState.extensionConnected = true;
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

        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.SendCallCommand, {
            command: "set-mute",
            value: true
        });
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.SendCallCommand, {
            command: "set-deaf",
            value: true
        });
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.SendCallCommand, {
            command: "set-camera",
            value: true
        });
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.SendCallCommand, {
            command: "set-screen",
            value: true
        });
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.SendCallCommand, {
            command: "focus-call-tab",
            value: undefined
        });
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.SendCallCommand, {
            command: "leave-call",
            value: undefined
        });
    });

    test("Call controls stay disabled while call state is syncing", async () => {
        mockState.extensionConnected = true;
        mockCallState({ ...IN_CALL_STATE, hasState: false });

        await mountApp();

        const callStatus = target.querySelector(".call-status") as HTMLSpanElement;
        const muteBtn = target.querySelector('button[title="Mute"]') as HTMLButtonElement;
        const leaveBtn = target.querySelector('button[title="Leave call"]') as HTMLButtonElement;

        expect(callStatus.textContent).toBe("Syncing call state...");
        expect(muteBtn.disabled).toBe(true);
        expect(leaveBtn.disabled).toBe(true);

        invokeMock.mockClear();
        await userEvent.click(muteBtn);
        expect(invokeMock).not.toHaveBeenCalledWith(IPC_COMMAND.SendCallCommand, expect.anything());
    });

    test("Reload WS button triggers update_ws_port", async () => {
        await mountApp();

        const settingsBtn = screen.getByRole("button", { name: /settings/i }) as HTMLButtonElement;
        await userEvent.click(settingsBtn);

        const reloadBtn = target.querySelector(".reload-btn") as HTMLButtonElement;
        const portInput = target.querySelector("#ws-port") as HTMLInputElement;
        expect(reloadBtn).toBeTruthy();
        expect(portInput).toBeTruthy();

        await updateInput(portInput, "55555");
        await userEvent.click(reloadBtn);
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.UpdateWsPort);
    });
});
