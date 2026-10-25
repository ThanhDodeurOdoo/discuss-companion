import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import {
    cleanupOwl,
    render,
    screen,
    userEvent,
    updateInput,
    nextTick
} from "@root/tests/utils/owl_test_utils";
import {
    CALL_COMMAND,
    IPC_COMMAND,
    type ChannelEvent,
    type CallStatePayload,
    type MacosPermissionStatus
} from "../ipc_types";

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
        macosPermissions: MacosPermissionStatus | null;
    };

    beforeEach(() => {
        jest.clearAllMocks();
        window.localStorage.clear();
        setupChannelMock.mockImplementation(async () => {});

        mockState = {
            features: { ptt: true, callControlsTray: true },
            appVisibilityMode: "trayAndDockWhenWindowOpen",
            extensionConnected: false,
            currentBinding: { code: 0, modifiers: [] },
            wsPort: 49152,
            accessibilityGranted: true,
            macosPermissions: null
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
                case IPC_COMMAND.GetMacosPermissionStatus:
                    return Promise.resolve(mockState.macosPermissions);
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
        return mounted.component.app;
    }

    test("macOS gates only PTT on both permissions without prompting on startup", async () => {
        mockState.macosPermissions = {
            accessibility: true,
            inputMonitoring: false,
            listenerRunning: false
        };
        await mountApp();
        expect(screen.getByRole("button", { name: "Review permissions" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /ptt/i })).toBeNull();
        expect(screen.queryByRole("button", { name: "Open Accessibility settings" })).toBeNull();
        expect(
            invokeMock.mock.calls.some(([cmd]) => cmd === IPC_COMMAND.RequestMacosPermission)
        ).toBe(false);
        expect(
            invokeMock.mock.calls.some(([cmd]) => cmd === IPC_COMMAND.OpenMacosPermissionSettings)
        ).toBe(false);
        expect(screen.queryByRole("dialog")).toBeNull();
        await userEvent.click(screen.getByRole("button", { name: "Review permissions" }));
        await userEvent.click(
            screen.getByRole("button", { name: "Request Input Monitoring access" })
        );
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.RequestMacosPermission, {
            permission: "inputMonitoring"
        });
        await userEvent.click(screen.getByRole("button", { name: "Open Accessibility settings" }));
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.OpenMacosPermissionSettings, {
            permission: "accessibility"
        });
    });

    test("macOS keeps PTT gated until the keyboard listener is healthy", async () => {
        mockState.macosPermissions = {
            accessibility: true,
            inputMonitoring: true,
            listenerRunning: false
        };
        await mountApp();
        await userEvent.click(screen.getByRole("button", { name: "Review permissions" }));
        expect(screen.getByText(/Waiting for keyboard capture/)).toBeTruthy();
        expect(screen.queryByRole("button", { name: /ptt/i })).toBeNull();
        mockState.macosPermissions.listenerRunning = true;
        await userEvent.click(screen.getByRole("button", { name: "Retry keyboard capture" }));
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.RetryKeyboardListener);
        expect(screen.getByRole("button", { name: /ptt/i })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Review permissions" })).toBeNull();
        expect(screen.getByRole("status").textContent).toContain("Keyboard capture active");
        expect(screen.getAllByText("Granted")).toHaveLength(2);
        await userEvent.click(screen.getByRole("button", { name: "Done" }));
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole("button", { name: /ptt/i }));
    });

    test.each([
        { accessibility: false, inputMonitoring: false, listenerRunning: false },
        { accessibility: true, inputMonitoring: false, listenerRunning: false },
        { accessibility: true, inputMonitoring: true, listenerRunning: false }
    ])("call controls and settings remain usable during PTT setup: %o", async (status) => {
        mockState.macosPermissions = status;
        mockState.extensionConnected = true;
        mockCallState(IN_CALL_STATE);
        await mountApp();

        expect(screen.queryByRole("button", { name: /ptt/i })).toBeNull();
        expect(screen.getByRole("button", { name: "Review permissions" })).toBeTruthy();
        const muteButton = screen.getByRole("button", { name: "Mute" });
        expect(muteButton).toHaveProperty("disabled", false);
        await userEvent.click(muteButton);
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.SendCallCommand, {
            command: CALL_COMMAND.SetMute,
            value: true
        });
        expect(target.querySelector(".logs-section")).not.toBeNull();

        const settingsButton = screen.getByRole("button", { name: "Settings" });
        expect(settingsButton).toHaveProperty("disabled", false);
        await userEvent.click(settingsButton);
        const portInput = target.querySelector("#ws-port") as HTMLInputElement;
        await updateInput(portInput, "55555");
        await userEvent.click(target.querySelector(".reload-btn") as HTMLButtonElement);
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.UpdateWsPort);
        await userEvent.click(settingsButton);
        expect(screen.getByRole("button", { name: "Review permissions" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Mute" })).toHaveProperty("disabled", false);
    });

    test("losing PTT access preserves active call controls", async () => {
        mockState.macosPermissions = {
            accessibility: true,
            inputMonitoring: true,
            listenerRunning: true
        };
        mockState.extensionConnected = true;
        mockCallState(IN_CALL_STATE);
        const app = await mountApp();
        await userEvent.click(screen.getByRole("button", { name: /ptt/i }));
        expect(app.isRecording()).toBe(true);

        mockState.macosPermissions = {
            accessibility: true,
            inputMonitoring: false,
            listenerRunning: false
        };
        await app.checkPermission();
        await nextTick();
        expect(app.isRecording()).toBe(false);
        expect(screen.queryByRole("button", { name: /ptt/i })).toBeNull();
        expect(screen.getByRole("button", { name: "Mute" })).toHaveProperty("disabled", false);
        expect(screen.getByRole("button", { name: "Settings" })).toHaveProperty("disabled", false);
    });

    test.each([
        { accessibility: false, inputMonitoring: false, listenerRunning: false },
        { accessibility: true, inputMonitoring: false, listenerRunning: false },
        { accessibility: false, inputMonitoring: true, listenerRunning: false }
    ])("missing permissions show opt-in guidance without a listener retry: %o", async (status) => {
        mockState.macosPermissions = status;
        await mountApp();
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.queryByRole("button", { name: "Open Accessibility settings" })).toBeNull();
        await userEvent.click(screen.getByRole("button", { name: "Review permissions" }));
        expect(screen.getByRole("dialog", { name: "Push-to-talk permissions" })).toHaveProperty(
            "open",
            true
        );
        const guidance = target.querySelector("details") as HTMLDetailsElement;
        expect(guidance.open).toBe(false);
        await userEvent.click(screen.getByText("Already enabled? It may be an old app entry."));
        expect(guidance.open).toBe(true);
        expect(screen.queryByRole("button", { name: "Retry keyboard capture" })).toBeNull();
        expect(invokeMock).not.toHaveBeenCalledWith(IPC_COMMAND.RetryKeyboardListener);
        await userEvent.click(screen.getByRole("button", { name: "Close permission details" }));
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByRole("button", { name: "Settings" })).toHaveProperty("disabled", false);
    });

    test("older WebViews can open and close inline permission recovery", async () => {
        const showModal = HTMLDialogElement.prototype.showModal;
        Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
            configurable: true,
            writable: true,
            value: undefined
        });
        try {
            mockState.macosPermissions = {
                accessibility: false,
                inputMonitoring: false,
                listenerRunning: false
            };
            await mountApp();
            const review = screen.getByRole("button", { name: "Review permissions" });
            await userEvent.click(review);
            expect(screen.getByRole("region", { name: "Push-to-talk permissions" })).toBeTruthy();
            await userEvent.click(
                screen.getByRole("button", { name: "Request Accessibility access" })
            );
            await userEvent.click(
                screen.getByRole("button", { name: "Open Accessibility settings" })
            );
            expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.OpenMacosPermissionSettings, {
                permission: "accessibility"
            });
            await userEvent.click(screen.getByRole("button", { name: "Close permission details" }));
            expect(screen.queryByRole("region", { name: "Push-to-talk permissions" })).toBeNull();
            expect(document.activeElement).toBe(review);
        } finally {
            HTMLDialogElement.prototype.showModal = showModal;
        }
    });

    test.each(["accessibility", "inputMonitoring"] as const)(
        "requests %s once, then offers Settings when macOS does not prompt",
        async (permission) => {
            mockState.macosPermissions = {
                accessibility: false,
                inputMonitoring: false,
                listenerRunning: false
            };
            const app = await mountApp();
            await userEvent.click(screen.getByRole("button", { name: "Review permissions" }));
            const name = permission === "accessibility" ? "Accessibility" : "Input Monitoring";
            await userEvent.click(screen.getByRole("button", { name: `Request ${name} access` }));
            expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.RequestMacosPermission, {
                permission
            });
            expect(invokeMock).not.toHaveBeenCalledWith(IPC_COMMAND.OpenMacosPermissionSettings, {
                permission
            });
            expect(screen.getByRole("status").textContent).toContain("if no prompt appears");
            await userEvent.click(screen.getByRole("button", { name: `Open ${name} settings` }));
            expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.OpenMacosPermissionSettings, {
                permission
            });
            expect(screen.getByRole("status").textContent).toContain(`In ${name}, turn on`);
            expect(screen.getByRole("status").textContent).toContain("use + to add it");
            expect(screen.queryByRole("button", { name: /ptt/i })).toBeNull();
            // Dismissing and reopening details must not repeat the native request.
            await userEvent.click(screen.getByRole("button", { name: "Close permission details" }));
            await userEvent.click(screen.getByRole("button", { name: "Review permissions" }));
            await userEvent.click(screen.getByRole("button", { name: `Open ${name} settings` }));
            expect(
                invokeMock.mock.calls.filter(([cmd]) => cmd === IPC_COMMAND.RequestMacosPermission)
            ).toHaveLength(1);

            mockState.macosPermissions[permission] = true;
            await app.checkPermission();
            await nextTick();
            expect(screen.queryByRole("status")).toBeNull();
        }
    );

    test("restart resumes live permission confirmation until Done, then stops resuming", async () => {
        mockState.macosPermissions = {
            accessibility: true,
            inputMonitoring: false,
            listenerRunning: false
        };
        await mountApp();
        await userEvent.click(screen.getByRole("button", { name: "Review permissions" }));
        await userEvent.click(
            screen.getByRole("button", { name: "Request Input Monitoring access" })
        );
        cleanupOwl();

        // macOS restarts the app after granting Input Monitoring.
        mockState.macosPermissions = {
            accessibility: true,
            inputMonitoring: true,
            listenerRunning: true
        };
        await mountApp();
        expect(screen.getByRole("dialog", { name: "Push-to-talk permissions" })).toHaveProperty(
            "open",
            true
        );
        expect(screen.getAllByText("Granted")).toHaveLength(2);
        expect(screen.getByRole("status").textContent).toContain("Keyboard capture active");
        await userEvent.click(screen.getByRole("button", { name: "Done" }));
        expect(screen.queryByRole("dialog")).toBeNull();
        cleanupOwl();
        await mountApp();
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByRole("button", { name: /ptt/i })).toBeTruthy();
    });

    test("resumed setup uses fresh status and does not claim capture is ready prematurely", async () => {
        mockState.macosPermissions = {
            accessibility: true,
            inputMonitoring: false,
            listenerRunning: false
        };
        await mountApp();
        await userEvent.click(screen.getByRole("button", { name: "Review permissions" }));
        cleanupOwl();
        mockState.macosPermissions.inputMonitoring = true;
        const app = await mountApp();
        expect(screen.getByRole("dialog")).toHaveProperty("open", true);
        expect(screen.getAllByText("Granted")).toHaveLength(2);
        expect(screen.getByText(/Waiting for keyboard capture/)).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Done" })).toBeNull();

        mockState.macosPermissions = {
            ...mockState.macosPermissions,
            accessibility: false
        };
        await app.checkPermission();
        await nextTick();
        expect(screen.getByText("Required")).toBeTruthy();
        expect(screen.queryByText(/Keyboard capture active/)).toBeNull();
        const dialog = screen.getByRole("dialog");
        dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
        await nextTick();
        expect(screen.queryByRole("dialog")).toBeNull();
        cleanupOwl();
        await mountApp();
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    test.each(["accessibility", "inputMonitoring"] as const)(
        "a failed %s request leaves Settings available without repeating the request",
        async (permission) => {
            mockState.macosPermissions = {
                accessibility: false,
                inputMonitoring: false,
                listenerRunning: false
            };
            await mountApp();
            await userEvent.click(screen.getByRole("button", { name: "Review permissions" }));
            const invoke = invokeMock.getMockImplementation();
            invokeMock.mockImplementation((cmd, ...args) =>
                cmd === IPC_COMMAND.RequestMacosPermission
                    ? Promise.reject(new Error("Consent unavailable"))
                    : invoke?.(cmd, ...args)
            );
            const name = permission === "accessibility" ? "Accessibility" : "Input Monitoring";
            await userEvent.click(screen.getByRole("button", { name: `Request ${name} access` }));
            expect(invokeMock).not.toHaveBeenCalledWith(IPC_COMMAND.OpenMacosPermissionSettings, {
                permission
            });
            expect(screen.getByRole("alert").textContent).toContain("Consent unavailable");
            expect(screen.getByRole("button", { name: `Open ${name} settings` })).toHaveProperty(
                "disabled",
                false
            );
            await userEvent.click(screen.getByRole("button", { name: `Open ${name} settings` }));
            expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.OpenMacosPermissionSettings, {
                permission
            });
            expect(
                invokeMock.mock.calls.filter(([cmd]) => cmd === IPC_COMMAND.RequestMacosPermission)
            ).toHaveLength(1);
            expect(screen.queryByRole("alert")).toBeNull();
            await userEvent.click(screen.getByRole("button", { name: "Close permission details" }));
            expect(screen.queryByRole("dialog")).toBeNull();
        }
    );

    test("settings launch failures are visible without claiming settings opened", async () => {
        mockState.macosPermissions = {
            accessibility: true,
            inputMonitoring: false,
            listenerRunning: false
        };
        await mountApp();
        await userEvent.click(screen.getByRole("button", { name: "Review permissions" }));
        await userEvent.click(
            screen.getByRole("button", { name: "Request Input Monitoring access" })
        );
        const invoke = invokeMock.getMockImplementation();
        invokeMock.mockImplementation((cmd, ...args) =>
            cmd === IPC_COMMAND.OpenMacosPermissionSettings
                ? Promise.reject(new Error("Unable to open System Settings"))
                : invoke?.(cmd, ...args)
        );
        await userEvent.click(
            screen.getByRole("button", { name: "Open Input Monitoring settings" })
        );
        expect(screen.getByRole("alert").textContent).toContain("Unable to open System Settings");
        expect(screen.getByRole("status").textContent).not.toContain("turn on Discuss Companion");
        expect(
            screen.getByRole("button", { name: "Open Input Monitoring settings" })
        ).toHaveProperty("disabled", false);
    });

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
            command: CALL_COMMAND.SetMute,
            value: true
        });
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.SendCallCommand, {
            command: CALL_COMMAND.SetDeaf,
            value: true
        });
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.SendCallCommand, {
            command: CALL_COMMAND.SetCamera,
            value: true
        });
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.SendCallCommand, {
            command: CALL_COMMAND.SetScreen,
            value: true
        });
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.SendCallCommand, {
            command: CALL_COMMAND.FocusCallTab,
            value: undefined
        });
        expect(invokeMock).toHaveBeenCalledWith(IPC_COMMAND.SendCallCommand, {
            command: CALL_COMMAND.LeaveCall,
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
