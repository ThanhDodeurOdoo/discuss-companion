import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { mockChrome, mockWebSocket, flushPromises } from "./utils.js";
import { MockPttExtensionService } from "./extension_service.mock.js";

const mockStorage = mockChrome({
    isTalkingByTabId: {}
});
mockWebSocket();

/**
 * Import background script to register listeners
 */
await import("../src/background.ts");

const capturedHandleMessage = chrome.runtime.onMessageExternal.addListener.mock.calls[0][0];

const { Message } = await import("../src/discuss/flatbuffers/message");
const { MessageBody } = await import("../src/discuss/flatbuffers/message-body");
const { PttDown } = await import("../src/discuss/flatbuffers/ptt-down");
const flatbuffers = await import("flatbuffers");

describe("PTT Service Compatibility", () => {
    let service;
    const TAB_ID = 101;

    beforeEach(() => {
        jest.clearAllMocks();
        mockStorage.isTalkingByTabId = {};
        service = new MockPttExtensionService();
        /**
         * Wire up the mock service to the extension background script
         * Service -> Extension
         */
        service.onSendMessage = (message) => {
            const sender = { tab: { id: TAB_ID } };
            const sendResponse = jest.fn();
            capturedHandleMessage(message, sender, sendResponse);
        };

        chrome.tabs.sendMessage.mockImplementation((tabId, message) => {
            if (tabId === TAB_ID) {
                service.receiveMessage(message);
            }
        });
    });

    test("Handshake: Service connects and gets enabled", async () => {
        service.start();
        await flushPromises();

        expect(service.isEnabled).toBe(true);
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(TAB_ID, {
            from: "discuss-push-to-talk",
            type: "answer-is-enabled"
        });
    });

    test("Subscribe and Unsubscribe flow", async () => {
        service.start();
        await flushPromises();

        service.subscribe();
        await flushPromises();

        expect(mockStorage.isTalkingByTabId[TAB_ID]).toBe(false);

        service.unsubscribe();
        await flushPromises();

        expect(mockStorage.isTalkingByTabId[TAB_ID]).toBeUndefined();
    });

    test("Is Talking state updates", async () => {
        service.start();
        await flushPromises();
        service.subscribe();

        service.notifyIsTalking(true);
        await flushPromises();
        expect(mockStorage.isTalkingByTabId[TAB_ID]).toBe(true);

        service.notifyIsTalking(false);
        await flushPromises();
        expect(mockStorage.isTalkingByTabId[TAB_ID]).toBe(false);
    });

    test("Receives Toggle Voice command", async () => {
        service.start();
        await flushPromises();
        service.subscribe();

        const builder = new flatbuffers.Builder(64);
        PttDown.startPttDown(builder);
        const pttOffset = PttDown.endPttDown(builder);
        Message.startMessage(builder);
        Message.addBodyType(builder, MessageBody.PttDown);
        Message.addBody(builder, pttOffset);
        builder.finish(Message.endMessage(builder));
        const data = builder.asUint8Array();

        const socket = global.mockSockets[0];
        socket.onmessage({ data });
        await flushPromises();

        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(TAB_ID, {
            from: "discuss-push-to-talk",
            type: "push-to-talk-pressed"
        });
    });
});
