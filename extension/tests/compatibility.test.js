import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { mockChrome, flushPromises } from "./utils.js";
import { MockPttExtensionService } from "./extension_service.mock.js";

const mockStorage = mockChrome({
    isTalkingByTabId: {},
    isCompanionEnabled: true
});

/**
 * Import service_worker script to register listeners
 */
await import("../src/service_worker.ts");

const capturedHandleMessage = chrome.runtime.onMessageExternal.addListener.mock.calls[0][0];

describe("PTT Service Compatibility", () => {
    let service;
    const TAB_ID = 101;

    beforeEach(() => {
        jest.clearAllMocks();
        mockStorage.isTalkingByTabId = {};
        service = new MockPttExtensionService();
        /**
         * Wire up the mock service to the extension service_worker script
         * Service -> Extension
         */
        service.onSendMessage = (message) => {
            const sender = { tab: { id: TAB_ID } };
            const sendResponse = jest.fn();
            capturedHandleMessage(message, sender, sendResponse);
        };

        chrome.tabs.sendMessage.mockImplementation((tabId, message) => {
            if (tabId === TAB_ID && message.from === "discuss-push-to-talk") {
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
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(TAB_ID, {
            type: "content-subscribe",
            value: { isOwner: true }
        });

        service.unsubscribe();
        await flushPromises();

        expect(mockStorage.isTalkingByTabId[TAB_ID]).toBeUndefined();
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(TAB_ID, { type: "content-unsubscribe" });
    });

    test("Is Talking state updates", async () => {
        service.start();
        await flushPromises();
        service.subscribe();
        await flushPromises();

        service.notifyIsTalking(true);
        await flushPromises();
        expect(mockStorage.isTalkingByTabId[TAB_ID]).toBe(true);

        service.notifyIsTalking(false);
        await flushPromises();
        expect(mockStorage.isTalkingByTabId[TAB_ID]).toBe(false);
    });
});
