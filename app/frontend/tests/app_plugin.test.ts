import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import type { App as OwlApp } from "@odoo/owl";
import type { AppPlugin as AppPluginType } from "../app_plugin.ts";
import { cleanupOwl, createOwlTestApp } from "@root/tests/utils/owl_test_utils";
import { CALL_COMMAND, IPC_COMMAND } from "../ipc_types";

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
        getMacosPermissionStatus: () => invokeMock(IPC_COMMAND.GetMacosPermissionStatus),
        requestMacosPermission: (permission: string) =>
            invokeMock(IPC_COMMAND.RequestMacosPermission, { permission }),
        openMacosPermissionSettings: (permission: string) =>
            invokeMock(IPC_COMMAND.OpenMacosPermissionSettings, { permission }),
        retryKeyboardListener: () => invokeMock(IPC_COMMAND.RetryKeyboardListener),
        isAccessibilityGranted: () => invokeMock(IPC_COMMAND.IsAccessibilityGranted),
        isExtensionConnected: () => invokeMock(IPC_COMMAND.IsExtensionConnected),
        getCurrentBinding: () => invokeMock(IPC_COMMAND.GetCurrentBinding),
        getWsPort: () => invokeMock(IPC_COMMAND.GetWsPort),
        forcePttUp: () => invokeMock(IPC_COMMAND.ForcePttUp),
        showMainWindow: () => invokeMock(IPC_COMMAND.ShowMainWindow),
        quitApp: () => invokeMock(IPC_COMMAND.QuitApp),
        setMute: (v: boolean) =>
            invokeMock(IPC_COMMAND.SendCallCommand, { command: CALL_COMMAND.SetMute, value: v }),
        setDeaf: (v: boolean) =>
            invokeMock(IPC_COMMAND.SendCallCommand, { command: CALL_COMMAND.SetDeaf, value: v }),
        setCamera: (v: boolean) =>
            invokeMock(IPC_COMMAND.SendCallCommand, { command: CALL_COMMAND.SetCamera, value: v }),
        setScreen: (v: boolean) =>
            invokeMock(IPC_COMMAND.SendCallCommand, { command: CALL_COMMAND.SetScreen, value: v }),
        openPip: () =>
            invokeMock(IPC_COMMAND.SendCallCommand, {
                command: CALL_COMMAND.OpenPip,
                value: undefined
            }),
        leaveCall: () =>
            invokeMock(IPC_COMMAND.SendCallCommand, {
                command: CALL_COMMAND.LeaveCall,
                value: undefined
            }),
        focusCallTab: () =>
            invokeMock(IPC_COMMAND.SendCallCommand, {
                command: CALL_COMMAND.FocusCallTab,
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
        window.localStorage.clear();
        setupChannelMock.mockImplementation(async () => {});
        owlApp = createOwlTestApp();
        plugin = new AppPlugin(owlApp.pluginManager);
    });

    afterEach(() => {
        plugin.destroyed = true;
        if (plugin.permissionTimer !== null) {
            window.clearTimeout(plugin.permissionTimer);
        }
        cleanupOwl();
        jest.useRealTimers();
    });

    test("permission loss clears capture and pressed state, then regrant recovers", async () => {
        plugin.isRecording.set(true);
        plugin.isPressed.set(true);
        invokeMock.mockResolvedValue({
            accessibility: true,
            inputMonitoring: false,
            listenerRunning: false
        } as never);
        await plugin.checkPermission();
        expect(plugin.needsPermissionSetup()).toBe(true);
        expect(plugin.isRecording()).toBe(false);
        expect(plugin.isPressed()).toBe(false);
        expect(invokeMock.mock.calls.map(([cmd]) => cmd)).toEqual([
            IPC_COMMAND.GetMacosPermissionStatus
        ]);
        invokeMock.mockResolvedValue({
            accessibility: true,
            inputMonitoring: true,
            listenerRunning: true
        } as never);
        await plugin.checkPermission();
        expect(plugin.needsPermissionSetup()).toBe(false);
        expect(plugin.permissionGranted()).toBe(true);
    });

    test("polling recovers without prompts and stops after destruction", async () => {
        jest.useFakeTimers();
        invokeMock.mockResolvedValue({
            accessibility: false,
            inputMonitoring: false,
            listenerRunning: false
        } as never);
        await plugin.checkPermission();
        plugin.schedulePermissionCheck();
        invokeMock.mockResolvedValue({
            accessibility: true,
            inputMonitoring: true,
            listenerRunning: true
        } as never);
        await jest.advanceTimersByTimeAsync(1000);
        expect(plugin.needsPermissionSetup()).toBe(false);
        expect(invokeMock.mock.calls.map(([cmd]) => cmd)).toEqual([
            IPC_COMMAND.GetMacosPermissionStatus,
            IPC_COMMAND.GetMacosPermissionStatus
        ]);
        plugin.destroyed = true;
        await jest.advanceTimersByTimeAsync(1000);
        expect(plugin.permissionTimer).toBeNull();
    });

    test("status errors gate controls and a subsequent check recovers", async () => {
        invokeMock.mockRejectedValueOnce(new Error("IPC unavailable") as never);
        await plugin.checkPermission();
        expect(plugin.needsPermissionSetup()).toBe(true);
        expect(plugin.permissionError()).toContain("IPC unavailable");
        invokeMock.mockResolvedValue(null as never);
        await plugin.checkPermission();
        expect(plugin.needsPermissionSetup()).toBe(false);
        expect(plugin.permissionError()).toBe("");
        plugin.schedulePermissionCheck();
        expect(plugin.permissionTimer).toBeNull();
    });

    test("each permission requests access once before opening Settings", async () => {
        invokeMock.mockResolvedValue({
            accessibility: false,
            inputMonitoring: false,
            listenerRunning: false
        } as never);
        await plugin.requestPermission("accessibility");
        await plugin.requestPermission("inputMonitoring");
        await plugin.requestPermission("accessibility");
        await plugin.requestPermission("inputMonitoring");
        expect(invokeMock.mock.calls).toEqual([
            [IPC_COMMAND.RequestMacosPermission, { permission: "accessibility" }],
            [IPC_COMMAND.GetMacosPermissionStatus],
            [IPC_COMMAND.RequestMacosPermission, { permission: "inputMonitoring" }],
            [IPC_COMMAND.GetMacosPermissionStatus],
            [IPC_COMMAND.OpenMacosPermissionSettings, { permission: "accessibility" }],
            [IPC_COMMAND.GetMacosPermissionStatus],
            [IPC_COMMAND.OpenMacosPermissionSettings, { permission: "inputMonitoring" }],
            [IPC_COMMAND.GetMacosPermissionStatus]
        ]);
    });

    test("permission review remains usable when persistence is unavailable", () => {
        const read = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("Storage unavailable");
        });
        const write = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("Storage unavailable");
        });
        const remove = jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
            throw new Error("Storage unavailable");
        });
        try {
            plugin.restorePermissionReview();
            plugin.setPermissionReviewOpen(true);
            expect(plugin.permissionReviewOpen()).toBe(true);
            plugin.setPermissionReviewOpen(false);
            expect(plugin.permissionReviewOpen()).toBe(false);
        } finally {
            read.mockRestore();
            write.mockRestore();
            remove.mockRestore();
        }
    });

    test("concurrent permission checks share a request and ignore late results", async () => {
        let resolveStatus: (value: unknown) => void = () => {};
        invokeMock.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveStatus = resolve;
                })
        );
        const first = plugin.checkPermission();
        const second = plugin.checkPermission();
        expect(invokeMock).toHaveBeenCalledTimes(1);
        plugin.destroyed = true;
        resolveStatus({ accessibility: true, inputMonitoring: true, listenerRunning: true });
        await Promise.all([first, second]);
        expect(plugin.permissionChecked()).toBe(false);
        plugin.schedulePermissionCheck();
        expect(plugin.permissionTimer).toBeNull();
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
            command: CALL_COMMAND.SetMute,
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
