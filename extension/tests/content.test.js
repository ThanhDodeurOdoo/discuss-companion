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

    test("relays version response from background to page", () => {
        const postMessageSpy = jest.spyOn(window, "postMessage");
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            if (message.type === "ask-version") {
                callback("1.2.3");
            }
        });

        const event = new MessageEvent("message", {
            data: { from: "discuss", type: "ask-version" },
            origin: "https://odoo.com",
            source: window
        });
        window.dispatchEvent(event);

        expect(postMessageSpy).toHaveBeenCalledWith(
            { from: "discuss-push-to-talk", type: "answer-version", value: "1.2.3" },
            "https://odoo.com"
        );
        postMessageSpy.mockRestore();
    });

    test("ignores messages with wrong 'from' field", () => {
        const event = new MessageEvent("message", {
            data: { from: "not-discuss", type: "is-talking", value: true },
            origin: "https://odoo.com",
            source: window
        });

        window.dispatchEvent(event);

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test("ignores messages from wrong origin", () => {
        const event = new MessageEvent("message", {
            data: { from: "discuss", type: "is-talking", value: true },
            origin: "https://evil.com",
            source: window
        });

        window.dispatchEvent(event);

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test("logs warning on runtime error when sending message to background", () => {
        const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        chrome.runtime.lastError = { message: "test error" };
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            callback();
        });

        const event = new MessageEvent("message", {
            data: { from: "discuss", type: "is-talking", value: true },
            origin: "https://odoo.com",
            source: window
        });
        window.dispatchEvent(event);

        expect(consoleSpy).toHaveBeenCalledWith(
            "[PTT-Bridge] Error sending to background:",
            "test error"
        );
        chrome.runtime.lastError = null;
        consoleSpy.mockRestore();
    });
});
