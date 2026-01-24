/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://odoo.com/"}
 */
import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { mockChrome } from "./utils.js";

mockChrome();

// We import it once at the top level
await import("../content.js");
const capturedCallback = chrome.runtime.onMessage.addListener.mock.calls[0][0];

describe("Extension Content Script", () => {
    const onMessageCallback = capturedCallback;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("should register a message listener", () => {
        expect(capturedCallback).toBeDefined();
    });

    test("forwards message from background to page", () => {
        const postMessageSpy = jest.spyOn(window, "postMessage");
        const request = { type: "test-type", value: "test-value" };
        const sender = { id: "test-extension-id" };

        onMessageCallback(request, sender);

        expect(postMessageSpy).toHaveBeenCalledWith(request, "https://odoo.com");
        postMessageSpy.mockRestore();
    });

    test("sends message from page to background", () => {
        const event = new MessageEvent("message", {
            data: { from: "discuss", type: "is-talking", value: true },
            origin: "https://odoo.com",
            source: window
        });

        window.dispatchEvent(event);

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            { type: "is-talking", value: true },
            expect.any(Function)
        );
    });
});
