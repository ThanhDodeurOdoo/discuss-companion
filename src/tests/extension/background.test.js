/**
 * @jest-environment jsdom
 */
import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { mockChrome, mockWebSocket } from "./utils.js";

const mockStorage = mockChrome({
    isTalkingByTabId: {}
});
mockWebSocket();

// Import background script
await import("../../../extension/background.js");
const capturedHandleMessage = chrome.runtime.onMessage.addListener.mock.calls[0][0];

describe("Extension Background Script", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockStorage.isTalkingByTabId = {};
    });

    test("should initialize and connect to WebSocket", () => {
        expect(global.WebSocket).toBeDefined();
    });

    test("handles subscribe message", async () => {
        const sendResponse = jest.fn();

        capturedHandleMessage({ type: "subscribe" }, { tab: { id: 123 } }, sendResponse);

        // Wait for async handleMessage
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(mockStorage.isTalkingByTabId[123]).toBe(false);
        expect(sendResponse).toHaveBeenCalledWith({ status: "ok" });
    });

    test("handles is-talking message and updates icon", async () => {
        capturedHandleMessage({ type: "is-talking", value: true }, { tab: { id: 123 } });

        // Wait for async handleMessage
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(mockStorage.isTalkingByTabId[123]).toBe(true);
        expect(chrome.action.setIcon).toHaveBeenCalledWith({
            path: "/assets/icons/active_icon.png"
        });
    });
});
