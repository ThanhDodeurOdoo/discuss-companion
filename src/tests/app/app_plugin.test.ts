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
const { AppPlugin } = await import("../../app_plugin.ts");

const mockedInvoke = invoke as jest.MockedFunction<typeof invoke>;
const mockedListen = listen as jest.MockedFunction<typeof listen>;

describe("AppPlugin", () => {
    let plugin: InstanceType<typeof AppPlugin>;

    beforeEach(() => {
        jest.clearAllMocks();
        plugin = new AppPlugin();
    });

    test("getKeyName returns correct names", () => {
        expect(plugin.getKeyName(49)).toBe("Space");
        expect(plugin.getKeyName(56)).toBe("Shift");
        expect(plugin.getKeyName(999)).toBe("Key 999");
    });

    test("addLog adds log entries and limits to 10", () => {
        for (let i = 0; i < 15; i++) {
            plugin.addLog("TEST", `message ${i}`);
        }
        expect(plugin.logs().length).toBe(10);
        expect(plugin.logs()[0].message).toBe("message 14");
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
