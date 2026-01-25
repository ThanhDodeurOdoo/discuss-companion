import { jest, describe, test, expect, beforeEach } from "@jest/globals";

jest.unstable_mockModule("@tauri-apps/api/core", () => ({
    __esModule: true,
    invoke: jest.fn()
}));

jest.unstable_mockModule("@tauri-apps/api/event", () => ({
    __esModule: true,
    listen: jest.fn()
}));

const { invoke } = await import("@tauri-apps/api/core");
const { listen } = await import("@tauri-apps/api/event");
const { AppPlugin } = await import("../app_plugin.ts");

const mockedInvoke = invoke as jest.MockedFunction<typeof invoke>;
const mockedListen = listen as jest.MockedFunction<typeof listen>;

describe("AppPlugin", () => {
    let plugin: InstanceType<typeof AppPlugin>;

    beforeEach(() => {
        jest.clearAllMocks();
        plugin = new AppPlugin();
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

        await plugin.toggleRecording();
        expect(plugin.isRecording()).toBe(true);
        expect(mockedInvoke).toHaveBeenCalledWith("set_recording_mode", { recording: true });

        await plugin.toggleRecording();
        expect(plugin.isRecording()).toBe(false);
        expect(mockedInvoke).toHaveBeenCalledWith("set_recording_mode", { recording: false });
    });

    test("setupListeners sets up event listeners", async () => {
        mockedInvoke.mockResolvedValue(true as never);
        mockedListen.mockResolvedValue((() => {}) as never);

        await plugin.setupListeners();

        expect(mockedInvoke).toHaveBeenCalledWith("is_extension_connected");
        expect(mockedListen).toHaveBeenCalledWith("ptt-event", expect.any(Function));
        expect(mockedListen).toHaveBeenCalledWith("error", expect.any(Function));
    });
});
