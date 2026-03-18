/**
 * @jest-environment jsdom
 */
import { beforeAll, beforeEach, afterEach, describe, expect, jest, test } from "@jest/globals";
import { xml } from "@odoo/owl";
import { cleanupOwl, render, nextTick, userEvent } from "@root/tests/utils/owl_test_utils";
import popupTemplateXml from "../src/popup/popup.xml";
import { mockChrome } from "./utils.js";

const DEFAULT_CALL_STATE = {
    isMute: false,
    isDeaf: false,
    isCameraOn: false,
    isScreenOn: false,
    isVoiceActivated: false
};

const mockStorage = mockChrome({
    wsPort: 49152,
    isLoggingEnabled: false,
    isCompanionEnabled: true,
    lastJoinedCall: null
});

const requestCallActionMock = jest.fn();
const requestCallStateMock = jest.fn();
const requestFocusCallTabMock = jest.fn();
const requestPttCommandMock = jest.fn();
const getCallTabIdMock = jest.fn();
const getStoredCallStateMock = jest.fn();
const executeInCurrentTabMock = jest.fn();

jest.unstable_mockModule("../src/command_api.ts", () => ({
    requestCallAction: requestCallActionMock,
    requestCallState: requestCallStateMock,
    requestFocusCallTab: requestFocusCallTabMock,
    requestPttCommand: requestPttCommandMock
}));

const setCallTabIdMock = jest.fn();
const setStoredCallStateMock = jest.fn();

jest.unstable_mockModule("../src/call_state.ts", () => ({
    getCallTabId: getCallTabIdMock,
    setCallTabId: setCallTabIdMock,
    getStoredCallState: getStoredCallStateMock,
    setStoredCallState: setStoredCallStateMock
}));

jest.unstable_mockModule("../src/utils.ts", () => ({
    executeInCurrentTab: executeInCurrentTabMock
}));

const { PopupPlugin } = await import("../src/popup/popup_plugin.ts");
const { Popup } = await import("../src/popup/popup_component.ts");
const { CallActionType } = await import("../src/call_actions.ts");
const { PttCommand } = await import("../src/page_bridge/runtime_types.ts");

function extractPopupTemplate(xmlSource) {
    const match = xmlSource.match(/<div t-name="Popup"[\s\S]*<\/div>/);
    if (!match) {
        throw new Error("Failed to extract Popup template from popup.xml");
    }
    return match[0].replace(' t-name="Popup"', "");
}

async function mountPopup() {
    const mounted = await render(Popup, {
        appConfig: {
            plugins: [PopupPlugin]
        }
    });
    await nextTick();
    await nextTick();
    return mounted.target;
}

beforeAll(() => {
    Popup.template = xml`${extractPopupTemplate(popupTemplateXml)}`;
});

describe("Popup UI", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockStorage.wsPort = 49152;
        mockStorage.isLoggingEnabled = false;
        mockStorage.isCompanionEnabled = true;
        mockStorage.lastJoinedCall = null;
        getCallTabIdMock.mockResolvedValue(101);
        getStoredCallStateMock.mockResolvedValue(undefined);
        requestCallStateMock.mockResolvedValue(DEFAULT_CALL_STATE);
        requestCallActionMock.mockResolvedValue({
            didRun: true,
            state: DEFAULT_CALL_STATE
        });
        requestPttCommandMock.mockResolvedValue({
            didRun: true,
            state: {
                ...DEFAULT_CALL_STATE,
                isVoiceActivated: true
            }
        });
        requestFocusCallTabMock.mockResolvedValue(true);
        executeInCurrentTabMock.mockResolvedValue({
            isOdoo: true,
            serverVersion: "18.0",
            owlVersion: "3.0.0"
        });
        jest.spyOn(window, "close").mockImplementation(() => undefined);
    });

    afterEach(() => {
        cleanupOwl();
        jest.restoreAllMocks();
    });

    test("dispatches call controls actions and voice toggle", async () => {
        const target = await mountPopup();

        const muteButton = target.querySelector('button[title="Mute"]');
        const deafenButton = target.querySelector('button[title="Deafen"]');
        const cameraButton = target.querySelector('button[title="Turn camera on"]');
        const screenButton = target.querySelector('button[title="Share screen"]');
        const leaveButton = target.querySelector('button[title="Leave call"]');
        const pipButton = target.querySelector('button[title="Open Picture in Picture"]');
        const voiceToggle = target.querySelector('button[role="switch"]');
        const goToCallButton = Array.from(target.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Go to Call"
        );

        expect(muteButton).toBeTruthy();
        expect(deafenButton).toBeTruthy();
        expect(cameraButton).toBeTruthy();
        expect(screenButton).toBeTruthy();
        expect(leaveButton).toBeTruthy();
        expect(pipButton).toBeTruthy();
        expect(voiceToggle).toBeTruthy();
        expect(goToCallButton).toBeTruthy();

        await userEvent.click(muteButton);
        await userEvent.click(deafenButton);
        await userEvent.click(cameraButton);
        await userEvent.click(screenButton);
        await userEvent.click(pipButton);
        await userEvent.click(leaveButton);
        await userEvent.click(voiceToggle);
        await userEvent.click(goToCallButton);

        expect(requestCallActionMock).toHaveBeenCalledWith(
            { type: CallActionType.ToggleMicrophone },
            { focusCallTab: false }
        );
        expect(requestCallActionMock).toHaveBeenCalledWith(
            { type: CallActionType.ToggleDeafen },
            { focusCallTab: false }
        );
        expect(requestCallActionMock).toHaveBeenCalledWith(
            { type: CallActionType.ToggleCamera },
            { focusCallTab: false }
        );
        expect(requestCallActionMock).toHaveBeenCalledWith(
            { type: CallActionType.ToggleScreen },
            { focusCallTab: true }
        );
        expect(requestCallActionMock).toHaveBeenCalledWith(
            { type: CallActionType.OpenPip },
            { focusCallTab: false }
        );
        expect(requestCallActionMock).toHaveBeenCalledWith(
            { type: CallActionType.LeaveCall },
            { focusCallTab: false }
        );
        expect(requestPttCommandMock).toHaveBeenCalledWith(PttCommand.ToggleVoice);
        expect(voiceToggle.getAttribute("aria-checked")).toBe("true");
        expect(requestFocusCallTabMock).toHaveBeenCalled();
        expect(window.close).toHaveBeenCalled();
    });

    test("shows and executes rejoin action when there is no active call tab", async () => {
        getCallTabIdMock.mockResolvedValue(null);
        getStoredCallStateMock.mockResolvedValue(DEFAULT_CALL_STATE);
        mockStorage.lastJoinedCall = {
            url: "https://odoo.com/odoo/action-mail.action_discuss?active_id=discuss.channel_7&call=accept",
            name: "General"
        };

        const target = await mountPopup();
        const rejoinButton = Array.from(target.querySelectorAll("button")).find((button) =>
            button.textContent?.includes('Re-join "General"')
        );

        expect(target.querySelector(".call")).toBeNull();
        expect(rejoinButton).toBeTruthy();

        await userEvent.click(rejoinButton);

        expect(chrome.tabs.create).toHaveBeenCalledWith({
            url: mockStorage.lastJoinedCall.url
        });
        expect(window.close).toHaveBeenCalled();
    });

    test("validates and saves websocket port from settings", async () => {
        const target = await mountPopup();
        const settingsButton = target.querySelector('button[title="Open settings"]');

        expect(settingsButton).toBeTruthy();
        await userEvent.click(settingsButton);

        const portInput = target.querySelector("#port");
        const saveButton = target.querySelector("#save");
        expect(portInput).toBeTruthy();
        expect(saveButton).toBeTruthy();

        portInput.value = "70000";
        portInput.dispatchEvent(new Event("input", { bubbles: true }));
        await nextTick();
        await userEvent.click(saveButton);

        const invalidStatus = target.querySelector("#status");
        expect(invalidStatus?.textContent).toContain("Invalid port number.");

        portInput.value = "55555";
        portInput.dispatchEvent(new Event("input", { bubbles: true }));
        await nextTick();
        await userEvent.click(saveButton);

        const successStatus = target.querySelector("#status");
        const savedWsPort = chrome.storage.local.set.mock.calls.at(-1)?.[0]?.wsPort;
        expect(Number(savedWsPort)).toBe(55555);
        expect(successStatus?.textContent).toContain("Options saved.");
    });

    test("clears stale call tab when call tab reports no active session", async () => {
        getCallTabIdMock.mockResolvedValue(101);
        requestCallStateMock.mockResolvedValue(undefined);
        getStoredCallStateMock.mockResolvedValue(undefined);

        const target = await mountPopup();

        expect(target.querySelector(".call")).toBeNull();
        expect(setCallTabIdMock).toHaveBeenCalledWith(null);
        expect(setStoredCallStateMock).toHaveBeenCalledWith(null);
    });

    test("reacts to session storage updates for call state and tab ownership", async () => {
        getCallTabIdMock.mockResolvedValue(null);
        getStoredCallStateMock.mockResolvedValue(undefined);
        const target = await mountPopup();

        expect(target.querySelector(".call")).toBeNull();

        const onStorageChanged = chrome.storage.onChanged.addListener.mock.calls[0][0];
        onStorageChanged(
            {
                callTabId: {
                    newValue: 24
                },
                callState: {
                    newValue: {
                        ...DEFAULT_CALL_STATE,
                        isMute: true
                    }
                }
            },
            "session"
        );
        await nextTick();

        expect(target.querySelector(".call")).toBeTruthy();
        expect(target.querySelector('button[title="Unmute"]')).toBeTruthy();
    });
});
