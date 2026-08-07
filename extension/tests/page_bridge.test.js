/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://odoo.com/"}
 */
import { afterEach, beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { effect, proxy, untrack } from "@odoo/owl";

const BRIDGE_CHANNEL = "discuss-companion-bridge";

let requestSequence = 0;

function nextRequestId() {
    requestSequence += 1;
    return `req-${requestSequence}`;
}

function asHostRecord(runtime, record) {
    if (runtime !== "owl3") {
        return record;
    }
    record.onChange = function (dependencies) {
        dependencies.bind(this);
    };
    return proxy(record);
}

function createSession(runtime, key, overrides = {}) {
    return asHostRecord(runtime, {
        localId: key,
        id: Number(key.replace(/\D/g, "")) || 1,
        isTalking: false,
        is_muted: false,
        is_deaf: false,
        get isMute() {
            return this.is_muted || this.is_deaf;
        },
        is_camera_on: false,
        is_screen_sharing_on: false,
        ...overrides
    });
}

function createStoreMock(runtime) {
    const watchers = [];
    const rtc = asHostRecord(runtime, {
        localSession: undefined,
        channel: { id: 1, name: "General", open: jest.fn() },
        pipService: {},
        pttExtService: {
            voiceActivated: false
        },
        setTalking: jest.fn(),
        onPushToTalk: jest.fn(),
        setPttReleaseTimeout: jest.fn(),
        toggleMicrophone: jest.fn(),
        toggleDeafen: jest.fn(),
        toggleVideo: jest.fn(),
        openPip: jest.fn(),
        leaveCall: jest.fn()
    });

    const onChange = jest.fn((target, key, cb) => {
        const watcher = {
            target,
            key,
            cb,
            active: true
        };
        watchers.push(watcher);
        return () => {
            watcher.active = false;
        };
    });

    const store = asHostRecord(runtime, {
        rtc,
        onChange
    });

    function triggerChange(target, key) {
        for (const watcher of watchers) {
            if (!watcher.active) {
                continue;
            }
            if (watcher.target !== target) {
                continue;
            }
            if (watcher.key !== key) {
                continue;
            }
            watcher.cb();
        }
    }

    return { store, rtc, triggerChange };
}

async function flushBridgeEvents() {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function setOdooStore(store, runtime) {
    window.odoo = {
        loader: {
            require: jest.fn((name) => {
                if (name !== "@odoo/owl") {
                    return undefined;
                }
                return runtime === "owl3" ? { effect, proxy, untrack } : {};
            })
        },
        __WOWL_DEBUG__: {
            root: {
                env: {
                    services: {
                        "mail.store": store
                    }
                }
            }
        }
    };
}

function createEventCollector() {
    const events = [];
    const listener = (event) => {
        const data = event.data;
        if (!data || data.channel !== BRIDGE_CHANNEL || data.kind !== "event") {
            return;
        }
        events.push(data);
    };
    window.addEventListener("message", listener);
    return {
        events,
        stop() {
            window.removeEventListener("message", listener);
        },
        byType(type) {
            return events.filter((event) => event.type === type);
        },
        last(type) {
            const entries = events.filter((event) => event.type === type);
            return entries[entries.length - 1];
        }
    };
}

async function bridgeRequest(type, payload) {
    const requestId = nextRequestId();
    const responsePromise = new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
            window.removeEventListener("message", onMessage);
            reject(new Error(`Timed out waiting for response to ${type}`));
        }, 500);

        function onMessage(event) {
            const data = event.data;
            if (!data || data.channel !== BRIDGE_CHANNEL || data.kind !== "response") {
                return;
            }
            if (data.requestId !== requestId) {
                return;
            }
            window.clearTimeout(timeoutId);
            window.removeEventListener("message", onMessage);
            resolve(data);
        }

        window.addEventListener("message", onMessage);
    });

    window.dispatchEvent(
        new MessageEvent("message", {
            data: {
                channel: BRIDGE_CHANNEL,
                kind: "request",
                requestId,
                type,
                payload
            },
            origin: window.location.origin,
            source: window
        })
    );

    return responsePromise;
}

beforeAll(async () => {
    await import("../src/page_bridge.ts");
});

describe.each(["saas-19.2", "owl3"])("page_bridge store watch on %s", (runtime) => {
    let collector;

    beforeEach(async () => {
        collector = createEventCollector();
        requestSequence = 0;
        window.odoo = undefined;
        await bridgeRequest("stop-store-watch");
        collector.events.length = 0;
    });

    afterEach(() => {
        collector.stop();
    });

    test("emits lifecycle and call-state updates from localSession watchers", async () => {
        const { store, rtc, triggerChange } = createStoreMock(runtime);
        setOdooStore(store, runtime);

        await bridgeRequest("start-store-watch");
        await flushBridgeEvents();
        expect(collector.last("call-lifecycle-update").payload).toEqual({
            hasRtcService: true,
            hasHostedCall: false,
            isTalking: false
        });

        const session = createSession(runtime, "A", { is_camera_on: true });
        rtc.localSession = session;
        triggerChange(rtc, "localSession");
        await flushBridgeEvents();

        expect(collector.last("call-lifecycle-update").payload).toEqual({
            hasRtcService: true,
            hasHostedCall: true,
            isTalking: false
        });
        expect(collector.last("call-state-update").payload).toEqual({
            hasState: true,
            state: {
                isMute: false,
                isDeaf: false,
                isCameraOn: true,
                isScreenOn: false,
                isVoiceActivated: false
            }
        });

        session.isTalking = true;
        triggerChange(session, "isTalking");
        await flushBridgeEvents();

        expect(collector.last("call-lifecycle-update").payload).toEqual({
            hasRtcService: true,
            hasHostedCall: true,
            isTalking: true
        });

        session.is_screen_sharing_on = true;
        triggerChange(session, "is_screen_sharing_on");
        await flushBridgeEvents();
        expect(collector.last("call-state-update").payload).toEqual({
            hasState: true,
            state: {
                isMute: false,
                isDeaf: false,
                isCameraOn: true,
                isScreenOn: true,
                isVoiceActivated: false
            }
        });
    });

    test("removes session listeners when localSession becomes falsy", async () => {
        const { store, rtc, triggerChange } = createStoreMock(runtime);
        setOdooStore(store, runtime);

        await bridgeRequest("start-store-watch");
        await flushBridgeEvents();

        const session = createSession(runtime, "A");
        rtc.localSession = session;
        triggerChange(rtc, "localSession");
        await flushBridgeEvents();

        const countAfterStart = collector.byType("call-lifecycle-update").length;

        rtc.localSession = undefined;
        triggerChange(rtc, "localSession");
        await flushBridgeEvents();

        expect(collector.last("call-lifecycle-update").payload).toEqual({
            hasRtcService: true,
            hasHostedCall: false,
            isTalking: false
        });

        const countAfterEnd = collector.byType("call-lifecycle-update").length;
        expect(countAfterEnd).toBeGreaterThan(countAfterStart);

        session.isTalking = true;
        triggerChange(session, "isTalking");
        await flushBridgeEvents();

        expect(collector.byType("call-lifecycle-update").length).toBe(countAfterEnd);
    });

    test("session switch ignores stale callbacks from previous session", async () => {
        const { store, rtc, triggerChange } = createStoreMock(runtime);
        setOdooStore(store, runtime);

        await bridgeRequest("start-store-watch");
        await flushBridgeEvents();

        const sessionA = createSession(runtime, "A", { is_camera_on: false });
        const sessionB = createSession(runtime, "B", { is_camera_on: true });

        rtc.localSession = sessionA;
        triggerChange(rtc, "localSession");
        await flushBridgeEvents();

        rtc.localSession = sessionB;
        triggerChange(rtc, "localSession");
        await flushBridgeEvents();

        const stateEventsBeforeStale = collector.byType("call-state-update").length;

        sessionA.is_screen_sharing_on = true;
        triggerChange(sessionA, "is_screen_sharing_on");
        await flushBridgeEvents();

        expect(collector.byType("call-state-update").length).toBe(stateEventsBeforeStale);

        sessionB.is_screen_sharing_on = true;
        triggerChange(sessionB, "is_screen_sharing_on");
        await flushBridgeEvents();

        expect(collector.last("call-state-update").payload).toEqual({
            hasState: true,
            state: {
                isMute: false,
                isDeaf: false,
                isCameraOn: true,
                isScreenOn: true,
                isVoiceActivated: false
            }
        });
    });

    test("bootstrap watcher attaches after delayed store availability", async () => {
        const { store, rtc, triggerChange } = createStoreMock(runtime);

        await bridgeRequest("start-store-watch");
        await flushBridgeEvents();

        setOdooStore(store, runtime);
        document.body.appendChild(document.createElement("div"));
        await flushBridgeEvents();

        const session = createSession(runtime, "A", { is_camera_on: true });
        rtc.localSession = session;
        triggerChange(rtc, "localSession");
        await flushBridgeEvents();

        expect(collector.last("call-lifecycle-update").payload).toEqual({
            hasRtcService: true,
            hasHostedCall: true,
            isTalking: false
        });
        expect(collector.last("call-state-update").payload.state.isCameraOn).toBe(true);

        session.isTalking = true;
        triggerChange(session, "isTalking");
        await flushBridgeEvents();

        expect(collector.last("call-lifecycle-update").payload.isTalking).toBe(true);
    });

    test("ptt-command uses rtc methods only with a localSession", async () => {
        const { store, rtc, triggerChange } = createStoreMock(runtime);
        setOdooStore(store, runtime);

        await bridgeRequest("start-store-watch");
        await flushBridgeEvents();

        let response = await bridgeRequest("ptt-command", { command: "ptt-down" });
        expect(response.payload).toEqual({ didRun: false, state: null });
        expect(rtc.onPushToTalk).not.toHaveBeenCalled();

        rtc.localSession = createSession(runtime, "A");
        triggerChange(rtc, "localSession");
        await flushBridgeEvents();

        response = await bridgeRequest("ptt-command", { command: "ptt-down" });
        expect(response.payload).toEqual({
            didRun: true,
            state: {
                isMute: false,
                isDeaf: false,
                isCameraOn: false,
                isScreenOn: false,
                isVoiceActivated: false
            }
        });
        expect(rtc.onPushToTalk).toHaveBeenCalledTimes(1);

        response = await bridgeRequest("ptt-command", { command: "ptt-up" });
        expect(response.payload.didRun).toBe(true);
        expect(response.payload.state.isVoiceActivated).toBe(false);
        expect(rtc.setPttReleaseTimeout).toHaveBeenCalled();

        response = await bridgeRequest("ptt-command", { command: "toggle-voice" });
        expect(response.payload.didRun).toBe(true);
        expect(response.payload.state.isVoiceActivated).toBe(true);
        expect(rtc.pttExtService.voiceActivated).toBe(true);
        expect(rtc.onPushToTalk).toHaveBeenCalledTimes(2);

        response = await bridgeRequest("ptt-command", { command: "ptt-down" });
        expect(response.payload.didRun).toBe(true);
        expect(response.payload.state.isVoiceActivated).toBe(false);
        expect(rtc.pttExtService.voiceActivated).toBe(false);
        expect(rtc.onPushToTalk).toHaveBeenCalledTimes(3);

        await bridgeRequest("ptt-command", { command: "ptt-up" });
        expect(rtc.setPttReleaseTimeout).toHaveBeenCalledTimes(2);

        response = await bridgeRequest("ptt-command", { command: "toggle-voice" });
        expect(response.payload.state.isVoiceActivated).toBe(true);
        expect(rtc.pttExtService.voiceActivated).toBe(true);
        expect(rtc.onPushToTalk).toHaveBeenCalledTimes(4);

        response = await bridgeRequest("ptt-command", { command: "toggle-voice" });
        expect(response.payload.state.isVoiceActivated).toBe(false);
        expect(rtc.pttExtService.voiceActivated).toBe(false);
        expect(rtc.setPttReleaseTimeout).toHaveBeenCalledWith(0);
    });

    test("mute transition forces voice latch off until re-toggled", async () => {
        const { store, rtc, triggerChange } = createStoreMock(runtime);
        setOdooStore(store, runtime);

        await bridgeRequest("start-store-watch");
        await flushBridgeEvents();

        const session = createSession(runtime, "A");
        rtc.localSession = session;
        triggerChange(rtc, "localSession");
        await flushBridgeEvents();

        let response = await bridgeRequest("ptt-command", { command: "toggle-voice" });
        expect(response.payload.state.isVoiceActivated).toBe(true);
        expect(rtc.pttExtService.voiceActivated).toBe(true);

        session.is_muted = true;
        triggerChange(session, "is_muted");
        await flushBridgeEvents();
        expect(collector.last("call-state-update").payload.state.isVoiceActivated).toBe(false);
        expect(rtc.pttExtService.voiceActivated).toBe(false);

        session.is_muted = false;
        triggerChange(session, "is_muted");
        await flushBridgeEvents();
        expect(collector.last("call-state-update").payload.state.isVoiceActivated).toBe(false);

        response = await bridgeRequest("read-call-state");
        expect(response.payload.state.isVoiceActivated).toBe(false);
    });

    test("muting and deafening actions explicitly stop talking", async () => {
        const { store, rtc, triggerChange } = createStoreMock(runtime);
        setOdooStore(store, runtime);

        await bridgeRequest("start-store-watch");
        await flushBridgeEvents();

        rtc.localSession = createSession(runtime, "A", { isTalking: true });
        triggerChange(rtc, "localSession");
        await flushBridgeEvents();

        await bridgeRequest("call-action", { action: { type: "toggle-microphone" } });
        expect(rtc.toggleMicrophone).toHaveBeenCalledTimes(1);
        expect(rtc.setTalking).toHaveBeenCalledWith(false);
        expect(rtc.pttExtService.voiceActivated).toBe(false);

        await bridgeRequest("call-action", { action: { type: "toggle-deafen" } });
        expect(rtc.toggleDeafen).toHaveBeenCalledTimes(1);
        expect(rtc.setTalking).toHaveBeenCalledTimes(2);
        expect(rtc.pttExtService.voiceActivated).toBe(false);

        await bridgeRequest("call-action", { action: { type: "set-mute", value: true } });
        expect(rtc.toggleMicrophone).toHaveBeenCalledTimes(2);
        expect(rtc.setTalking).toHaveBeenCalledTimes(3);

        await bridgeRequest("call-action", { action: { type: "set-deaf", value: true } });
        expect(rtc.toggleDeafen).toHaveBeenCalledTimes(2);
        expect(rtc.setTalking).toHaveBeenCalledTimes(4);
    });

    test("stops observing host records until watching restarts", async () => {
        const { store, rtc, triggerChange } = createStoreMock(runtime);
        setOdooStore(store, runtime);

        await bridgeRequest("start-store-watch");
        rtc.localSession = createSession(runtime, "A");
        triggerChange(rtc, "localSession");
        await flushBridgeEvents();

        await bridgeRequest("stop-store-watch");
        await flushBridgeEvents();
        collector.events.length = 0;
        window.odoo = undefined;

        rtc.localSession = undefined;
        triggerChange(rtc, "localSession");
        await flushBridgeEvents();

        expect(collector.events).toHaveLength(0);

        setOdooStore(store, runtime);
        await bridgeRequest("start-store-watch");
        const nextSession = createSession(runtime, "B");
        rtc.localSession = nextSession;
        triggerChange(rtc, "localSession");
        await flushBridgeEvents();
        collector.events.length = 0;

        nextSession.isTalking = true;
        triggerChange(nextSession, "isTalking");
        await flushBridgeEvents();

        expect(collector.byType("call-lifecycle-update")).toHaveLength(1);
        expect(collector.last("call-lifecycle-update").payload.isTalking).toBe(true);
    });
});
