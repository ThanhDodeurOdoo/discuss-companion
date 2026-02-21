import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import type { App as OwlApp } from "@odoo/owl";
import type { AppPlugin as AppPluginType } from "../app_plugin.ts";
import { cleanupOwl, createOwlTestApp } from "@root/tests/utils/owl_test_utils";

jest.unstable_mockModule("@tauri-apps/api/core", () => ({
    __esModule: true,
    invoke: jest.fn(),
    Channel: jest.fn()
}));

jest.unstable_mockModule("@tauri-apps/api/event", () => ({
    __esModule: true,
    listen: jest.fn()
}));

jest.unstable_mockModule("../ipc.ts", () => ({
    __esModule: true,
    setRecordingMode: jest.fn(),
    updateBinding: jest.fn(),
    updateWsPort: jest.fn(),
    setupChannel: jest.fn(),
    sendCallCommand: jest.fn()
}));

const { invoke } = await import("@tauri-apps/api/core");
const { listen } = await import("@tauri-apps/api/event");
const { AppPlugin } = await import("../app_plugin.ts");
const { CallCommand } = await import("../call_commands.ts");
const { setRecordingMode, setupChannel, sendCallCommand } = await import("../ipc.ts");

const mockedInvoke = invoke as jest.MockedFunction<typeof invoke>;
const mockedListen = listen as jest.MockedFunction<typeof listen>;
const mockedSetRecordingMode = setRecordingMode as jest.MockedFunction<typeof setRecordingMode>;
const mockedSetupChannel = setupChannel as jest.MockedFunction<typeof setupChannel>;
const mockedSendCallCommand = sendCallCommand as jest.MockedFunction<typeof sendCallCommand>;

describe("AppPlugin", () => {
    let plugin: AppPluginType;
    let owlApp: OwlApp;

    beforeEach(() => {
        jest.clearAllMocks();
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
        mockedInvoke.mockResolvedValue(undefined as never);
        mockedSetRecordingMode.mockResolvedValue(undefined as never);

        await plugin.toggleRecording();
        expect(plugin.isRecording()).toBe(true);
        expect(mockedSetRecordingMode).toHaveBeenCalledWith(true);

        await plugin.toggleRecording();
        expect(plugin.isRecording()).toBe(false);
        expect(mockedSetRecordingMode).toHaveBeenCalledWith(false);
    });

    test("toggleMute sends call command when state is known", async () => {
        mockedSendCallCommand.mockResolvedValue(true as never);
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

        expect(mockedSendCallCommand).toHaveBeenCalledWith(CallCommand.SetMute, true);
    });

    test("setupListeners sets up event listeners", async () => {
        mockedInvoke.mockResolvedValue(true as never);
        mockedListen.mockResolvedValue((() => {}) as never);
        mockedSetupChannel.mockResolvedValue(undefined as never);

        await plugin.setupListeners();

        expect(mockedInvoke).toHaveBeenCalledWith("is_extension_connected");
        expect(mockedSetupChannel).toHaveBeenCalled();
    });

    test("showMainWindow invokes show_main_window command", async () => {
        mockedInvoke.mockResolvedValue(undefined as never);

        await plugin.showMainWindow();

        expect(mockedInvoke).toHaveBeenCalledWith("show_main_window");
    });

    test("quitApp invokes quit_app command", async () => {
        mockedInvoke.mockResolvedValue(undefined as never);

        await plugin.quitApp();

        expect(mockedInvoke).toHaveBeenCalledWith("quit_app");
    });

    test("setAppVisibilityMode invokes set_app_visibility_mode and updates state", async () => {
        mockedInvoke.mockResolvedValue(undefined as never);

        await plugin.setAppVisibilityMode("dockOnly");

        expect(mockedInvoke).toHaveBeenCalledWith("set_app_visibility_mode", { mode: "dockOnly" });
        expect(plugin.appVisibilityMode()).toBe("dockOnly");
    });
});
