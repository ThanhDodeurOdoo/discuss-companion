/**
 * @jest-environment jsdom
 */
import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { mockChrome, mockWebSocket } from "./utils.js";

const mockStorage = mockChrome({
    isTalkingByTabId: {},
    isCompanionEnabled: true
});
mockWebSocket();

// Import background script
await import("../src/background.ts");
const capturedHandleMessage = chrome.runtime.onMessage.addListener.mock.calls[0][0];
const capturedOnRemoved = chrome.tabs.onRemoved.addListener.mock.calls[0][0];
const capturedOnAlarm = chrome.alarms.onAlarm.addListener.mock.calls[0][0];
const capturedOnClicked = chrome.action.onClicked.addListener.mock.calls[0][0];
const capturedOnChanged = chrome.storage.onChanged.addListener.mock.calls[0][0];

const { Message } = await import("../src/discuss/ws-protocol/message");
const { MessageBody } = await import("../src/discuss/ws-protocol/message-body");
const { PttDown } = await import("../src/discuss/ws-protocol/ptt-down");
const { PttUp } = await import("../src/discuss/ws-protocol/ptt-up");
const flatbuffers = await import("flatbuffers");

describe("Extension Background Script", () => {
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
