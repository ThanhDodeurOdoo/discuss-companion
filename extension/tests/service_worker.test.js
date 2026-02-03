/**
 * @jest-environment jsdom
 */
import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { flushPromises, mockChrome } from "./utils.js";

const mockStorage = mockChrome({
    isTalkingByTabId: {},
    appConnected: true
});

await import("../src/service_worker.ts");
const capturedHandleMessage = chrome.runtime.onMessage.addListener.mock.calls[0][0];
const capturedOnRemoved = chrome.tabs.onRemoved.addListener.mock.calls[0][0];
const capturedOnClicked = chrome.action.onClicked.addListener.mock.calls[0][0];

const { CallActionType } = await import("../src/call_actions.ts");

describe("Extension Service Worker", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockStorage.isTalkingByTabId = {};
        mockStorage.appConnected = true;
        mockStorage.callTabId = null;
    });

    test("handles subscribe message and sends content-subscribe", async () => {
        const sendResponse = jest.fn();

        capturedHandleMessage({ type: "subscribe" }, { tab: { id: 123 } }, sendResponse);
        await flushPromises();

        expect(mockStorage.isTalkingByTabId[123]).toBe(false);
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(123, {
            type: "content-subscribe",
            value: { isOwner: true }
        });
        expect(sendResponse).toHaveBeenCalledWith({ status: "ok" });
    });

    test("handles subscribe for non-owner tab", async () => {
        mockStorage.isTalkingByTabId[111] = false;
        mockStorage.callTabId = 111;
        const sendResponse = jest.fn();

        capturedHandleMessage({ type: "subscribe" }, { tab: { id: 222 } }, sendResponse);
        await flushPromises();

        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(222, {
            type: "content-subscribe",
            value: { isOwner: false }
        });
    });

    test("handles unsubscribe message", async () => {
        mockStorage.isTalkingByTabId[123] = true;
        mockStorage.callTabId = 123;
        const sendResponse = jest.fn();

        capturedHandleMessage({ type: "unsubscribe" }, { tab: { id: 123 } }, sendResponse);
        await flushPromises();

        expect(mockStorage.isTalkingByTabId[123]).toBeUndefined();
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(123, { type: "content-unsubscribe" });
        expect(sendResponse).toHaveBeenCalledWith({ status: "ok" });
        expect(chrome.action.setIcon).toHaveBeenCalled();
    });

    test("handles is-talking message and updates icon", async () => {
        capturedHandleMessage({ type: "is-talking", value: true }, { tab: { id: 123 } });
        await flushPromises();

        expect(mockStorage.isTalkingByTabId[123]).toBe(true);
        expect(chrome.action.setIcon).toHaveBeenCalledWith({
            path: "/assets/icons/active_online_icon.png"
        });
    });

    test("handles ask-is-enabled message", async () => {
        const sendResponse = jest.fn();
        capturedHandleMessage({ type: "ask-is-enabled" }, { tab: { id: 123 } }, sendResponse);
        await flushPromises();

        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(123, {
            from: "discuss-push-to-talk",
            type: "answer-is-enabled"
        });
        expect(sendResponse).toHaveBeenCalledWith({ status: "ok" });
    });

    test("handles ask-version message", async () => {
        const sendResponse = jest.fn();
        capturedHandleMessage({ type: "ask-version" }, {}, sendResponse);
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith("1.0.0");
    });

    test("forwards call-action to content script", async () => {
        mockStorage.callTabId = 123;
        chrome.tabs.sendMessage.mockImplementation((_tabId, _message, callback) => {
            callback({ status: "ok", didRun: true, state: { isMute: true } });
        });
        const sendResponse = jest.fn();

        capturedHandleMessage(
            { type: "call-action", value: { action: { type: CallActionType.OpenPip } } },
            { tab: { id: 999 } },
            sendResponse
        );
        await flushPromises();

        expect(chrome.tabs.sendMessage).toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith({
            status: "ok",
            didRun: true,
            state: { isMute: true }
        });
    });

    test("forwards refresh-call-state to content script", async () => {
        mockStorage.callTabId = 123;
        chrome.tabs.sendMessage.mockImplementation((_tabId, _message, callback) => {
            callback({ status: "ok", state: { isMute: false } });
        });
        const sendResponse = jest.fn();

        capturedHandleMessage({ type: "refresh-call-state" }, {}, sendResponse);
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith({ status: "ok", state: { isMute: false } });
    });

    test("handles focus-call-tab message", async () => {
        mockStorage.callTabId = 123;
        chrome.tabs.get.mockResolvedValueOnce({ id: 123, windowId: 1 });
        const sendResponse = jest.fn();

        capturedHandleMessage({ type: "focus-call-tab" }, {}, sendResponse);
        await flushPromises();

        expect(chrome.tabs.get).toHaveBeenCalledWith(123);
        expect(chrome.tabs.update).toHaveBeenCalledWith(123, { active: true });
        expect(chrome.windows.update).toHaveBeenCalledWith(1, { focused: true });
        expect(sendResponse).toHaveBeenCalledWith({ status: "ok", didFocus: true });
    });

    test("handles content-connection-state update", async () => {
        const sendResponse = jest.fn();
        capturedHandleMessage(
            { type: "content-connection-state", value: { isConnected: false } },
            { tab: { id: 123 } },
            sendResponse
        );
        await flushPromises();

        expect(mockStorage.appConnected).toBe(false);
        expect(chrome.action.setIcon).toHaveBeenCalledWith({
            path: "/assets/icons/inactive_offline_icon.png"
        });
    });

    test("stores call state updates from content", async () => {
        const sendResponse = jest.fn();
        const state = {
            isMute: true,
            isDeaf: false,
            isCameraOn: true,
            isScreenOn: false
        };

        capturedHandleMessage(
            { type: "content-call-state-update", value: { state } },
            { tab: { id: 123 } },
            sendResponse
        );
        await flushPromises();

        expect(mockStorage.callState).toEqual(state);
        expect(sendResponse).toHaveBeenCalledWith({ status: "ok" });
    });

    test("removes tab from storage on tab removal", async () => {
        mockStorage.isTalkingByTabId[123] = true;

        await capturedOnRemoved(123);

        expect(mockStorage.isTalkingByTabId[123]).toBeUndefined();
        expect(chrome.action.setIcon).toHaveBeenCalled();
    });

    test("sets appConnected false when owner tab is removed", async () => {
        mockStorage.isTalkingByTabId[123] = true;
        mockStorage.callTabId = 123;
        mockStorage.appConnected = true;

        await capturedOnRemoved(123);

        expect(mockStorage.appConnected).toBe(false);
    });

    test("opens shortcuts page on action click", async () => {
        capturedOnClicked();
        expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "chrome://extensions/shortcuts" });
    });
});
