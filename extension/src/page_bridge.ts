import type { CallAction } from "./call_actions";
import type { CallState } from "./call_state_types";
import {
    BRIDGE_CHANNEL,
    type BridgeEvent,
    type BridgeRequest,
    type BridgeRequestType,
    type BridgeResponse,
    isBridgeMessage
} from "./messaging/bridge_protocol";

const BRIDGE_MARKER = "__DISCUSS_COMPANION_PAGE_BRIDGE_INSTALLED__";

(() => {
    type RtcSelfSession = {
        isMute: boolean;
        is_deaf: boolean;
        is_camera_on: boolean;
        is_screen_sharing_on: boolean;
    };

    type RtcChannel = {
        id: number;
        name: string;
        open: () => void;
    };

    type RtcService = {
        selfSession?: RtcSelfSession;
        channel?: RtcChannel;
        pipService?: unknown;
        toggleMicrophone: () => Promise<void> | void;
        toggleDeafen: () => Promise<void> | void;
        toggleVideo: (type: "camera" | "screen") => Promise<void> | void;
        openPip: (options: Record<string, unknown>) => Promise<void> | void;
        leaveCall: () => Promise<void> | void;
    };

    type MailStore = {
        rtc?: RtcService;
    };

    type OdooWindow = Window & {
        odoo?: {
            __WOWL_DEBUG__?: {
                root: {
                    env: {
                        services: {
                            "mail.store"?: MailStore;
                        };
                    };
                };
            };
        };
    };

    const win = window as OdooWindow;
    const markerStore = win as unknown as Record<string, boolean | undefined>;
    if (markerStore[BRIDGE_MARKER]) {
        return;
    }
    markerStore[BRIDGE_MARKER] = true;

    function getStore(): MailStore | undefined {
        return win.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    }

    function readCallState(): CallState | null {
        const store = getStore();
        const selfSession = store?.rtc?.selfSession;
        if (!selfSession) {
            return null;
        }
        return {
            isMute: Boolean(selfSession.isMute),
            isDeaf: Boolean(selfSession.is_deaf),
            isCameraOn: Boolean(selfSession.is_camera_on),
            isScreenOn: Boolean(selfSession.is_screen_sharing_on)
        };
    }

    function openChannelInTab(): boolean {
        const store = getStore();
        if (!store?.rtc?.channel) {
            return false;
        }
        store.rtc.channel.open();
        return true;
    }

    async function toggleMicrophoneInTab(): Promise<boolean> {
        const store = getStore();
        if (!store?.rtc?.selfSession) {
            return false;
        }
        await store.rtc.toggleMicrophone();
        return true;
    }

    async function toggleDeafenInTab(): Promise<boolean> {
        const store = getStore();
        if (!store?.rtc?.selfSession) {
            return false;
        }
        await store.rtc.toggleDeafen();
        return true;
    }

    async function toggleCameraInTab(): Promise<boolean> {
        const store = getStore();
        if (!store?.rtc?.selfSession) {
            return false;
        }
        await store.rtc.toggleVideo("camera");
        return true;
    }

    async function toggleScreenInTab(): Promise<boolean> {
        const store = getStore();
        if (!store?.rtc?.selfSession) {
            return false;
        }
        await store.rtc.toggleVideo("screen");
        return true;
    }

    async function openPipInTab(): Promise<boolean> {
        const store = getStore();
        if (!store?.rtc?.pipService) {
            return false;
        }
        await store.rtc.openPip({});
        return true;
    }

    async function leaveCallInTab(): Promise<boolean> {
        const store = getStore();
        if (!store?.rtc?.leaveCall) {
            return false;
        }
        await store.rtc.leaveCall();
        return true;
    }

    async function setMuteInTab(value: boolean): Promise<boolean> {
        const store = getStore();
        const selfSession = store?.rtc?.selfSession;
        if (!selfSession) {
            return false;
        }
        if (selfSession.isMute !== value) {
            await store?.rtc?.toggleMicrophone();
        }
        return true;
    }

    async function setDeafInTab(value: boolean): Promise<boolean> {
        const store = getStore();
        const selfSession = store?.rtc?.selfSession;
        if (!selfSession) {
            return false;
        }
        if (selfSession.is_deaf !== value) {
            await store?.rtc?.toggleDeafen();
        }
        return true;
    }

    async function setCameraInTab(value: boolean): Promise<boolean> {
        const store = getStore();
        const selfSession = store?.rtc?.selfSession;
        if (!selfSession) {
            return false;
        }
        if (selfSession.is_camera_on !== value) {
            await store?.rtc?.toggleVideo("camera");
        }
        return true;
    }

    async function setScreenInTab(value: boolean): Promise<boolean> {
        const store = getStore();
        const selfSession = store?.rtc?.selfSession;
        if (!selfSession) {
            return false;
        }
        if (selfSession.is_screen_sharing_on !== value) {
            await store?.rtc?.toggleVideo("screen");
        }
        return true;
    }

    async function runAction(action: CallAction): Promise<boolean> {
        switch (action.type) {
            case "toggle-microphone":
                return toggleMicrophoneInTab();
            case "toggle-deafen":
                return toggleDeafenInTab();
            case "toggle-camera":
                return toggleCameraInTab();
            case "toggle-screen":
                return toggleScreenInTab();
            case "open-pip":
                return openPipInTab();
            case "leave-call":
                return leaveCallInTab();
            case "open-channel":
                return openChannelInTab();
            case "set-mute":
                return "value" in action ? setMuteInTab(action.value) : false;
            case "set-deaf":
                return "value" in action ? setDeafInTab(action.value) : false;
            case "set-camera":
                return "value" in action ? setCameraInTab(action.value) : false;
            case "set-screen":
                return "value" in action ? setScreenInTab(action.value) : false;
            default:
                return false;
        }
    }

    let observerTimeoutId: number | null = null;
    let observerActiveDelay = 1000;
    let observerIdleDelay = 5000;
    let observerRunning = false;
    let lastSignature = "";

    function emitCallState(state: CallState | null) {
        const payload = state ? { hasState: true, state } : { hasState: false };
        const signature = JSON.stringify(payload);
        if (signature === lastSignature) {
            return;
        }
        lastSignature = signature;
        const event: BridgeEvent = {
            channel: BRIDGE_CHANNEL,
            kind: "event",
            type: "call-state-update",
            payload
        };
        window.postMessage(event, location.origin);
    }

    function tickObserver() {
        if (!observerRunning) {
            return;
        }
        const state = readCallState();
        emitCallState(state);
        const delay = state ? observerActiveDelay : observerIdleDelay;
        observerTimeoutId = window.setTimeout(tickObserver, delay);
    }

    function startObserver(activeDelay: number, idleDelay: number) {
        observerActiveDelay = activeDelay;
        observerIdleDelay = idleDelay;
        if (observerRunning) {
            return;
        }
        observerRunning = true;
        tickObserver();
    }

    function stopObserver() {
        observerRunning = false;
        if (observerTimeoutId !== null) {
            window.clearTimeout(observerTimeoutId);
            observerTimeoutId = null;
        }
    }

    function getCallInfo() {
        const store = getStore();
        const channel = store?.rtc?.channel;
        return {
            channelId: channel?.id,
            channelName: channel?.name,
            origin: window.location.origin
        };
    }

    function buildResponse(requestId: string, ok: boolean, payload?: unknown): BridgeResponse {
        return {
            channel: BRIDGE_CHANNEL,
            kind: "response",
            requestId,
            ok,
            payload
        };
    }

    async function handleRequest(request: BridgeRequest): Promise<BridgeResponse> {
        const { requestId, type, payload } = request;
        switch (type as BridgeRequestType) {
            case "call-action": {
                const action = (payload as { action?: CallAction } | undefined)?.action;
                if (!action) {
                    return buildResponse(requestId, false, { error: "invalid-action" });
                }
                const didRun = await runAction(action);
                const state = readCallState();
                return buildResponse(requestId, true, { didRun, state });
            }
            case "read-call-state": {
                const state = readCallState();
                return buildResponse(requestId, true, { state });
            }
            case "start-observer": {
                const delays = payload as { activeDelay?: number; idleDelay?: number } | undefined;
                startObserver(
                    delays?.activeDelay ?? observerActiveDelay,
                    delays?.idleDelay ?? observerIdleDelay
                );
                return buildResponse(requestId, true, { running: true });
            }
            case "stop-observer": {
                stopObserver();
                return buildResponse(requestId, true, { running: false });
            }
            case "get-call-info": {
                return buildResponse(requestId, true, getCallInfo());
            }
            default:
                return buildResponse(requestId, false, { error: "unknown-request" });
        }
    }

    window.addEventListener("message", (event) => {
        if (event.source !== window || event.origin !== location.origin) {
            return;
        }
        if (!isBridgeMessage(event.data)) {
            return;
        }
        const message = event.data;
        if (message.kind !== "request") {
            return;
        }
        void handleRequest(message as BridgeRequest).then((response) => {
            window.postMessage(response, location.origin);
        });
    });
})();
