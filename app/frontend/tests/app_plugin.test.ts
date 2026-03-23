import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import type { App as OwlApp } from "@odoo/owl";
import type { AppPlugin as AppPluginType } from "../app_plugin.ts";
import { cleanupOwl, createOwlTestApp } from "@root/tests/utils/owl_test_utils";
import { IPC_COMMAND } from "../ipc_types";

const invokeMock = jest.fn();
const setupChannelMock = jest.fn();

jest.unstable_mockModule("@tauri-apps/api/core", () => ({
    __esModule: true,
    invoke: invokeMock,
    Channel: jest.fn()
}));

jest.unstable_mockModule("@tauri-apps/api/event", () => ({
    __esModule: true,
    listen: jest.fn()
}));

jest.unstable_mockModule("../ipc.ts", () => {
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

const { listen } = await import("@tauri-apps/api/event");
const { AppPlugin } = await import("../app_plugin.ts");

const mockedListen = listen as jest.MockedFunction<typeof listen>;

describe("AppPlugin", () => {
    let plugin: AppPluginType;
    let owlApp: OwlApp;

    beforeEach(() => {
        jest.clearAllMocks();
        setupChannelMock.mockImplementation(async () => {});
        owlApp = createOwlTestApp();
        plugin = new AppPlugin(owlApp.pluginManager);
    });

    afterEach(() => {
        cleanupOwl();
    });

    test("formatKeyBinding returns correct names", () => {
        expect(plugin.formatKeyBinding(49)).toBe("Space");
        expect(plugin.formatKeyBinding(56)).toBe("Shift");
        expect(plugin.formatKeyBinding(999)).toBe("Key 999");
        expect(plugin.formatKeyBinding(49, [0, 3])).toBe("Cmd+Shift+Space");
    });

    test("addLog adds log entries and limits to 20", () => {
        for (let i = 0; i < 30; i++) {
            plugin.addLog("TEST", `message ${i}`);
        }
        expect(plugin.logs().length).toBe(20);
        expect(plugin.logs()[0].message).toBe("message 29");
    });

    test("toggleRecording", async () => {
        invokeMock.mockResolvedValue(undefined as never);

        await plugin.toggleRecording();
        expect(plugin.isRecording()).toBe(true);
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.SetRecordingMode);

        await plugin.toggleRecording();
        expect(plugin.isRecording()).toBe(false);
        const recordingCalls = invokeMock.mock.calls.filter(
            ([cmd]) => cmd === IPC_COMMAND.SetRecordingMode
        );
        expect(recordingCalls).toHaveLength(2);
    });

    test("toggleMute sends call command when state is known", async () => {
        invokeMock.mockImplementation((cmd) => {
            if (cmd === IPC_COMMAND.SendCallCommand) {
                return Promise.resolve(true);
            }
            return Promise.resolve(undefined);
        });
        plugin.extensionConnected.set(true);
        plugin.applyCallState({
            hasCall: true,
            hasState: true,
            isMute: false,
            isDeaf: false,
            isCameraOn: false,
            isScreenOn: false
        });

        await plugin.toggleMute();

        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.SendCallCommand, {
            command: "set-mute",
            value: true
        });
    });

    test("setupListeners sets up event listeners", async () => {
        invokeMock.mockResolvedValue(true as never);
        mockedListen.mockResolvedValue((() => {}) as never);

        await plugin.setupListeners();

        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.IsExtensionConnected);
        expect(setupChannelMock).toHaveBeenCalled();
    });

    test("setupListeners registers the channel before Tauri event listeners", async () => {
        invokeMock.mockResolvedValue(true as never);
        mockedListen.mockResolvedValue((() => {}) as never);

        await plugin.setupListeners();

        expect(setupChannelMock.mock.invocationCallOrder[0]).toBeLessThan(
            mockedListen.mock.invocationCallOrder[0]
        );
    });

    test("binding capture updates the key without leaving PTT pressed", async () => {
        invokeMock.mockResolvedValue(undefined as never);
        const listeners = new Map<string, (event: { payload: unknown }) => Promise<void> | void>();
        mockedListen.mockImplementation(async (eventName, callback) => {
            listeners.set(
                eventName,
                callback as (event: { payload: unknown }) => Promise<void> | void
            );
            return (() => {}) as never;
        });

        await plugin.setupListeners();
        plugin.isRecording.set(true);
        plugin.isPressed.set(true);

        const bindingCaptureListener = listeners.get("binding-captured");
        expect(bindingCaptureListener).toBeDefined();

        await bindingCaptureListener?.({
            payload: {
                ts: Date.now(),
                key: { code: 49, modifiers: [1] }
            }
        });

        expect(plugin.isRecording()).toBe(false);
        expect(plugin.isPressed()).toBe(false);
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.SetRecordingMode);
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.UpdateBinding);
        expect(plugin.currentBinding()).toEqual({ code: 49, modifiers: [1] });
    });

    test("showMainWindow invokes show_main_window command", async () => {
        invokeMock.mockResolvedValue(undefined as never);

        await plugin.showMainWindow();

        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.ShowMainWindow);
    });

    test("quitApp invokes quit_app command", async () => {
        invokeMock.mockResolvedValue(undefined as never);

        await plugin.quitApp();

        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.QuitApp);
    });

    test("setAppVisibilityMode invokes set_app_visibility_mode and updates state", async () => {
        invokeMock.mockResolvedValue(undefined as never);

        await plugin.setAppVisibilityMode("dockOnly");

        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.SetAppVisibilityMode, {
            mode: "dockOnly"
        });
        expect(plugin.appVisibilityMode()).toBe("dockOnly");
    });
});
