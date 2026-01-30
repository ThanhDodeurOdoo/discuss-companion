/**
 * @jest-environment jsdom
 */
import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { flushPromises, mockChrome, mockWebSocket } from "./utils.js";

const mockStorage = mockChrome({
    isTalkingByTabId: {},
    isCompanionEnabled: true
});
mockWebSocket();

// Import service_worker script
await import("../src/service_worker.ts");
const capturedHandleMessage = chrome.runtime.onMessage.addListener.mock.calls[0][0];
const capturedOnRemoved = chrome.tabs.onRemoved.addListener.mock.calls[0][0];
const capturedOnAlarm = chrome.alarms.onAlarm.addListener.mock.calls[0][0];
const capturedOnClicked = chrome.action.onClicked.addListener.mock.calls[0][0];
const capturedOnChanged = chrome.storage.onChanged.addListener.mock.calls[0][0];

const { Message } = await import("../src/discuss/ws-protocol/message.ts");
const { MessageBody } = await import("../src/discuss/ws-protocol/message-body.ts");
const { PttDown } = await import("../src/discuss/ws-protocol/ptt-down.ts");
const { PttUp } = await import("../src/discuss/ws-protocol/ptt-up.ts");
const { CallActionType } = await import("../src/call_actions.ts");
const flatbuffers = await import("flatbuffers");

describe("Extension Service_worker Script", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockStorage.isTalkingByTabId = {};
        mockStorage.isCompanionEnabled = true;
    });

    test("should initialize and connect to WebSocket", () => {
        expect(global.WebSocket).toBeDefined();
    });

    test("handles subscribe message", async () => {
        const sendResponse = jest.fn();

        capturedHandleMessage({ type: "subscribe" }, { tab: { id: 123 } }, sendResponse);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(mockStorage.isTalkingByTabId[123]).toBe(false);
        expect(sendResponse).toHaveBeenCalledWith({ status: "ok" });
    });

    test("handles unsubscribe message", async () => {
        mockStorage.isTalkingByTabId[123] = true;
        const sendResponse = jest.fn();

        capturedHandleMessage({ type: "unsubscribe" }, { tab: { id: 123 } }, sendResponse);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(mockStorage.isTalkingByTabId[123]).toBeUndefined();
        expect(sendResponse).toHaveBeenCalledWith({ status: "ok" });
        expect(chrome.action.setIcon).toHaveBeenCalled();
    });

    test("handles is-talking message and updates icon", async () => {
        capturedHandleMessage({ type: "is-talking", value: true }, { tab: { id: 123 } });
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(mockStorage.isTalkingByTabId[123]).toBe(true);
        expect(chrome.action.setIcon).toHaveBeenCalledWith({
            path: "/assets/icons/active_online_icon.png"
        });
    });

    test("handles ask-is-enabled message", async () => {
        const sendResponse = jest.fn();
        capturedHandleMessage({ type: "ask-is-enabled" }, { tab: { id: 123 } }, sendResponse);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(123, {
            from: "discuss-push-to-talk",
            type: "answer-is-enabled"
        });
        expect(sendResponse).toHaveBeenCalledWith({ status: "ok" });
    });

    test("handles ask-version message", async () => {
        const sendResponse = jest.fn();
        capturedHandleMessage({ type: "ask-version" }, {}, sendResponse);
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(sendResponse).toHaveBeenCalledWith("1.0.0");
    });

    test("handles update-mute message", async () => {
        mockStorage.callTabId = 123;
        chrome.scripting.executeScript
            .mockResolvedValueOnce([{ result: true }])
            .mockResolvedValueOnce([
                {
                    result: {
                        isMute: true,
                        isDeaf: false,
                        isCameraOn: true,
                        isScreenOn: false
                    }
                }
            ]);
        const sendResponse = jest.fn();

        capturedHandleMessage(
            { type: "update-mute", value: true },
            { tab: { id: 123 } },
            sendResponse
        );
        await flushPromises();

        expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
        expect(sendResponse).toHaveBeenCalledWith({
            status: "ok",
            didRun: true,
            state: {
                isMute: true,
                isDeaf: false,
                isCameraOn: true,
                isScreenOn: false
            }
        });
        expect(mockStorage.callState).toEqual({
            isMute: true,
            isDeaf: false,
            isCameraOn: true,
            isScreenOn: false
        });
    });

    test("handles call-action message", async () => {
        mockStorage.callTabId = 123;
        chrome.scripting.executeScript
            .mockResolvedValueOnce([{ result: true }])
            .mockResolvedValueOnce([
                {
                    result: {
                        isMute: false,
                        isDeaf: false,
                        isCameraOn: true,
                        isScreenOn: true
                    }
                }
            ]);
        const sendResponse = jest.fn();

        capturedHandleMessage(
            {
                type: "call-action",
                value: { action: { type: CallActionType.OpenPip }, options: {} }
            },
            { tab: { id: 123 } },
            sendResponse
        );
        await flushPromises();

        expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
        expect(sendResponse).toHaveBeenCalledWith({
            status: "ok",
            didRun: true,
            state: {
                isMute: false,
                isDeaf: false,
                isCameraOn: true,
                isScreenOn: true
            }
        });
    });

    test("handles refresh-call-state message", async () => {
        mockStorage.callTabId = 123;
        chrome.scripting.executeScript.mockResolvedValueOnce([
            {
                result: {
                    isMute: true,
                    isDeaf: true,
                    isCameraOn: false,
                    isScreenOn: false
                }
            }
        ]);
        const sendResponse = jest.fn();

        capturedHandleMessage({ type: "refresh-call-state" }, {}, sendResponse);
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith({
            status: "ok",
            state: {
                isMute: true,
                isDeaf: true,
                isCameraOn: false,
                isScreenOn: false
            }
        });
    });

    test("handles call-state-observer-update message", async () => {
        mockStorage.callTabId = null;
        const sendResponse = jest.fn();

        capturedHandleMessage(
            {
                type: "call-state-observer-update",
                value: {
                    hasState: true,
                    state: {
                        isMute: false,
                        isDeaf: true,
                        isCameraOn: false,
                        isScreenOn: true
                    }
                }
            },
            { tab: { id: 456 } },
            sendResponse
        );
        await flushPromises();

        expect(mockStorage.callTabId).toBe(456);
        expect(mockStorage.callState).toEqual({
            isMute: false,
            isDeaf: true,
            isCameraOn: false,
            isScreenOn: true
        });
        expect(sendResponse).toHaveBeenCalledWith({ status: "ok" });
    });

    test("handles focus-call-tab message", async () => {
        mockStorage.callTabId = 123;
        chrome.scripting.executeScript.mockResolvedValueOnce([{ result: true }]);
        const sendResponse = jest.fn();

        capturedHandleMessage({ type: "focus-call-tab" }, {}, sendResponse);
        await flushPromises();

        expect(chrome.tabs.get).toHaveBeenCalledWith(123);
        expect(chrome.tabs.update).toHaveBeenCalledWith(123, { active: true });
        expect(chrome.windows.update).toHaveBeenCalledWith(1, { focused: true });
        expect(sendResponse).toHaveBeenCalledWith({ status: "ok", didFocus: true });
    });

    test("removes tab from storage on tab removal", async () => {
        mockStorage.isTalkingByTabId[123] = true;

        await capturedOnRemoved(123);

        expect(mockStorage.isTalkingByTabId[123]).toBeUndefined();
        expect(chrome.action.setIcon).toHaveBeenCalled();
    });

    test("handles WebSocket ptt-pressed message", async () => {
        mockStorage.isTalkingByTabId[123] = false;

        const builder = new flatbuffers.Builder(64);
        PttDown.startPttDown(builder);
        const pttOffset = PttDown.endPttDown(builder);

        Message.startMessage(builder);
        Message.addBodyType(builder, MessageBody.PttDown);
        Message.addBody(builder, pttOffset);
        const offset = Message.endMessage(builder);
        builder.finish(offset);
        const data = builder.asUint8Array();

        const socket = global.mockSockets[0];
        socket.onmessage({ data });
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(123, {
            from: "discuss-push-to-talk",
            type: "push-to-talk-pressed"
        });
    });

    test("handles WebSocket ptt-released message", async () => {
        mockStorage.isTalkingByTabId[123] = true;

        const builder = new flatbuffers.Builder(64);
        PttUp.startPttUp(builder);
        const pttOffset = PttUp.endPttUp(builder);

        Message.startMessage(builder);
        Message.addBodyType(builder, MessageBody.PttUp);
        Message.addBody(builder, pttOffset);
        const offset = Message.endMessage(builder);
        builder.finish(offset);
        const data = builder.asUint8Array();

        const socket = global.mockSockets[0];
        socket.onmessage({ data });
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(123, {
            from: "discuss-push-to-talk",
            type: "push-to-talk-released"
        });
    });

    test("reconnects on alarm", async () => {
        const initialCount = global.mockSockets.length;
        if (global.mockSockets.length > 0) {
            global.mockSockets[global.mockSockets.length - 1].close();
        }
        await capturedOnAlarm({ name: "reconnect_alarm" });
        expect(global.mockSockets.length).toBeGreaterThan(initialCount);
    });

    test("disables companion app and stops WebSocket", async () => {
        capturedOnChanged({ isCompanionEnabled: { newValue: true } }, "local");
        const socket = global.mockSockets[global.mockSockets.length - 1];

        capturedOnChanged({ isCompanionEnabled: { newValue: false } }, "local");

        expect(socket.close).toHaveBeenCalled();
        expect(chrome.alarms.clear).toHaveBeenCalledWith("reconnect_alarm");
    });

    test("enables companion app and starts WebSocket", async () => {
        capturedOnChanged({ isCompanionEnabled: { newValue: false } }, "local");
        const initialCount = global.mockSockets.length;

        capturedOnChanged({ isCompanionEnabled: { newValue: true } }, "local");

        expect(global.mockSockets.length).toBeGreaterThan(initialCount);
    });

    test("opens shortcuts page on action click", async () => {
        capturedOnClicked();
        expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "chrome://extensions/shortcuts" });
    });
});
