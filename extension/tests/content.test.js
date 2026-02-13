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
const BRIDGE_CHANNEL = "discuss-companion-bridge";

function setupBridgeAutoResponses({ hasOdoo = true, hasRtcService = true } = {}) {
    const requests = [];
    const originalPostMessage = window.postMessage.bind(window);

    jest.spyOn(window, "postMessage").mockImplementation((message, origin) => {
        if (
            message &&
            typeof message === "object" &&
            message.channel === BRIDGE_CHANNEL &&
            message.kind === "request"
        ) {
            requests.push(message);
            let payload;
            switch (message.type) {
                case "probe-rtc":
                    payload = { hasOdoo, hasRtcService };
                    break;
                case "start-store-watch":
                    payload = { running: true, hasRtcService };
                    break;
                case "stop-store-watch":
                    payload = { running: false };
                    break;
                case "read-call-state":
                    payload = { state: null };
                    break;
                case "ptt-command":
                    payload = { didRun: true };
                    break;
                default:
                    payload = { running: true };
            }
            const response = {
                channel: BRIDGE_CHANNEL,
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

    return { requests };
}

function emitBridgeEvent(type, payload) {
    window.dispatchEvent(
        new MessageEvent("message", {
            data: {
                channel: BRIDGE_CHANNEL,
                kind: "event",
                type,
                payload
            },
            origin: "https://odoo.com",
            source: window
        })
    );
}

function loadBridgeScript() {
    const script = document.getElementById(BRIDGE_SCRIPT_ID);
    expect(script).toBeTruthy();
    script.onload?.(new Event("load"));
}

describe("Extension Content Script", () => {
    const onMessageCallback = capturedCallback;

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
        global.mockSockets.length = 0;
        mockStorage.isCompanionEnabled = true;
        chrome.runtime.sendMessage.mockImplementation((_message, callback) => {
            callback?.({ status: "ok" });
        });
    });

    test("should register a message listener", () => {
        expect(capturedCallback).toBeDefined();
    });

    test("starts bridge store watch on Odoo pages", async () => {
        const { requests } = setupBridgeAutoResponses({ hasOdoo: true, hasRtcService: true });

        loadBridgeScript();
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(requests.some((request) => request.type === "start-store-watch")).toBe(true);
    });

    test("processes lifecycle events and updates service worker subscription", async () => {
        setupBridgeAutoResponses({ hasOdoo: true, hasRtcService: true });
        loadBridgeScript();
        await flushPromises();

        emitBridgeEvent("call-lifecycle-update", {
            hasRtcService: true,
            hasHostedCall: true,
            isTalking: true
        });
        await flushPromises();

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            { type: "subscribe" },
            expect.any(Function)
        );
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            { type: "is-talking", value: true },
            expect.any(Function)
        );

        emitBridgeEvent("call-lifecycle-update", {
            hasRtcService: true,
            hasHostedCall: false,
            isTalking: false
        });
        await flushPromises();

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            { type: "unsubscribe" },
            expect.any(Function)
        );
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            { type: "is-talking", value: false },
            expect.any(Function)
        );
    });

    test("sends ptt command to page bridge when requested by service worker", async () => {
        const { requests } = setupBridgeAutoResponses({ hasOdoo: true, hasRtcService: true });
        loadBridgeScript();
        await flushPromises();

        const sendResponse = jest.fn();
        onMessageCallback(
            {
                type: "content-ptt-command",
                value: { command: "ptt-down" }
            },
            { id: "test-extension-id" },
            sendResponse
        );

        await flushPromises();

        expect(requests.some((request) => request.type === "ptt-command")).toBe(true);
        expect(sendResponse).toHaveBeenCalledWith({
            status: "ok",
            didRun: true,
            state: undefined
        });
    });

    test("connects WebSocket when owner and companion enabled", async () => {
        setupBridgeAutoResponses({ hasOdoo: true, hasRtcService: true });
        onMessageCallback(
            { type: "content-subscribe", value: { isOwner: true } },
            { id: "test-extension-id" }
        );

        loadBridgeScript();
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(global.mockSockets.length).toBeGreaterThan(0);
    });

    test("does not connect WebSocket when not owner", async () => {
        setupBridgeAutoResponses({ hasOdoo: true, hasRtcService: true });
        onMessageCallback(
            { type: "content-subscribe", value: { isOwner: false } },
            { id: "test-extension-id" }
        );
        loadBridgeScript();
        await flushPromises();

        expect(global.mockSockets.length).toBe(0);
    });

    test("does not clear persisted call state when ownership changes but subscription remains", async () => {
        setupBridgeAutoResponses({ hasOdoo: true, hasRtcService: true });
        loadBridgeScript();
        await flushPromises();

        onMessageCallback(
            { type: "content-subscribe", value: { isOwner: true } },
            { id: "test-extension-id" }
        );
        await flushPromises();

        emitBridgeEvent("call-state-update", {
            hasState: true,
            state: {
                isMute: false,
                isDeaf: false,
                isCameraOn: true,
                isScreenOn: false,
                isVoiceActivated: false
            }
        });
        await flushPromises();

        jest.clearAllMocks();
        chrome.runtime.sendMessage.mockImplementation((_message, callback) => {
            callback?.({ status: "ok" });
        });

        onMessageCallback(
            { type: "content-owner-update", value: { isOwner: false } },
            { id: "test-extension-id" }
        );
        await flushPromises();

        const nullStateWrites = chrome.runtime.sendMessage.mock.calls.filter(([message]) => {
            return message?.type === "content-call-state-update" && message.value?.state === null;
        });
        expect(nullStateWrites).toHaveLength(0);
    });
});
