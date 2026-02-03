/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://odoo.com/"}
 */
import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { flushPromises, mockChrome, mockWebSocket } from "./utils.js";

const mockStorage = mockChrome({
    isCompanionEnabled: true
});
mockWebSocket();

await import("../src/content.ts");
const capturedCallback = chrome.runtime.onMessage.addListener.mock.calls[0][0];

const BRIDGE_SCRIPT_ID = "__discuss_companion_page_bridge__";

function setupBridgeAutoResponses() {
    const originalPostMessage = window.postMessage.bind(window);
    jest.spyOn(window, "postMessage").mockImplementation((message, origin) => {
        if (
            message &&
            typeof message === "object" &&
            message.channel === "discuss-companion-bridge" &&
            message.kind === "request"
        ) {
            const payload =
                message.type === "read-call-state" ? { state: null } : { running: true };
            const response = {
                channel: "discuss-companion-bridge",
                kind: "response",
                requestId: message.requestId,
                ok: true,
                payload
            };
            window.dispatchEvent(
                new MessageEvent("message", {
                    data: response,
                    origin: "https://odoo.com",
                    source: window
                })
            );
        }
        return originalPostMessage(message, origin);
    });
}

describe("Extension Content Script", () => {
    const onMessageCallback = capturedCallback;

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
        global.mockSockets.length = 0;
        mockStorage.isCompanionEnabled = true;
    });

    test("should register a message listener", () => {
        expect(capturedCallback).toBeDefined();
    });

    test("forwards discuss-push-to-talk message from service worker to page", () => {
        const postMessageSpy = jest.spyOn(window, "postMessage");
        const request = { from: "discuss-push-to-talk", type: "push-to-talk-pressed" };
        const sender = { id: "test-extension-id" };

        onMessageCallback(request, sender);

        expect(postMessageSpy).toHaveBeenCalledWith(request, "https://odoo.com");
        postMessageSpy.mockRestore();
    });

    test("sends message from page to service worker", () => {
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

    test("relays version response from service worker to page", () => {
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

    test("connects WebSocket when owner and companion enabled", async () => {
        setupBridgeAutoResponses();
        onMessageCallback(
            { type: "content-subscribe", value: { isOwner: true } },
            { id: "test-extension-id" }
        );

        const script = document.getElementById(BRIDGE_SCRIPT_ID);
        expect(script).toBeTruthy();
        script.onload?.(new Event("load"));
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(global.mockSockets.length).toBeGreaterThan(0);
    });

    test("does not connect WebSocket when not owner", async () => {
        onMessageCallback(
            { type: "content-subscribe", value: { isOwner: false } },
            { id: "test-extension-id" }
        );
        await flushPromises();

        expect(global.mockSockets.length).toBe(0);
    });

    test("logs warning on runtime error when sending message to service worker", () => {
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
            "[PTT-Bridge] Error sending to service worker:",
            "test error"
        );
        chrome.runtime.lastError = null;
        consoleSpy.mockRestore();
    });
});
