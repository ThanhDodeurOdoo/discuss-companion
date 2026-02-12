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

type PttCommand = "ptt-down" | "ptt-up" | "toggle-voice";

type RtcSession = {
    localId?: string;
    id?: number;
    isTalking: boolean;
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
    localSession?: RtcSession;
    channel?: RtcChannel;
    pipService?: unknown;
    onPushToTalk: () => void;
    setPttReleaseTimeout: (duration?: number) => void;
    toggleMicrophone: () => Promise<void> | void;
    toggleDeafen: () => Promise<void> | void;
    toggleVideo: (type: "camera" | "screen") => Promise<void> | void;
    openPip: (options: Record<string, unknown>) => Promise<void> | void;
    leaveCall: () => Promise<void> | void;
};

type MailStore = {
    rtc?: RtcService;
    onChange: (target: object, key: string | string[], cb: () => void) => (() => void) | void;
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

(() => {
    const win = window as OdooWindow;
    const markerStore = win as unknown as Record<string, boolean | undefined>;
    if (markerStore[BRIDGE_MARKER]) {
        return;
    }
    markerStore[BRIDGE_MARKER] = true;

    let lastLifecycleSignature = "";
    let lastCallStateSignature = "";

    let stopRtcWatcher: (() => void) | null = null;
    const stopSessionWatchers: Array<() => void> = [];
    let stopBootstrapWatcher: (() => void) | null = null;

    let storeWatchRunning = false;
    let activeSessionToken = 0;
    let activeSessionKey: string | null = null;
    let voiceActivated = false;

    function getStore(): MailStore | undefined {
        return win.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    }

    function getRtc(): RtcService | undefined {
        return getStore()?.rtc;
    }

    function getSessionKey(session?: RtcSession): string | null {
        if (!session) {
            return null;
        }
        if (typeof session.localId === "string" && session.localId.length > 0) {
            return session.localId;
        }
        if (typeof session.id === "number") {
            return `session-${session.id}`;
        }
        return null;
    }

    function readCallState(): CallState | null {
        const session = getRtc()?.localSession;
        if (!session) {
            return null;
        }
        return {
            isMute: Boolean(session.isMute),
            isDeaf: Boolean(session.is_deaf),
            isCameraOn: Boolean(session.is_camera_on),
            isScreenOn: Boolean(session.is_screen_sharing_on)
        };
    }

    function emitBridgeEvent(type: BridgeEvent["type"], payload: unknown) {
        const event: BridgeEvent = {
            channel: BRIDGE_CHANNEL,
            kind: "event",
            type,
            payload
        };
        window.postMessage(event, location.origin);
    }

    function emitLifecycle(payload: {
        hasRtcService: boolean;
        hasHostedCall: boolean;
        isTalking: boolean;
    }) {
        const signature = JSON.stringify(payload);
        if (signature === lastLifecycleSignature) {
            return;
        }
        lastLifecycleSignature = signature;
        emitBridgeEvent("call-lifecycle-update", payload);
    }

    function emitCallState(state: CallState | null) {
        const payload = state ? { hasState: true, state } : { hasState: false };
        const signature = JSON.stringify(payload);
        if (signature === lastCallStateSignature) {
            return;
        }
        lastCallStateSignature = signature;
        emitBridgeEvent("call-state-update", payload);
    }

    function cleanupSessionWatchers() {
        for (const stop of stopSessionWatchers.splice(0)) {
            stop();
        }
    }

    function addSessionWatcherStop(stop: (() => void) | void) {
        if (typeof stop !== "function") {
            return;
        }
        stopSessionWatchers.push(stop);
    }

    function cleanupBootstrapWatcher() {
        if (!stopBootstrapWatcher) {
            return;
        }
        stopBootstrapWatcher();
        stopBootstrapWatcher = null;
    }

    function isCurrentSession(token: number, sessionKey: string | null): boolean {
        return (
            storeWatchRunning &&
            token === activeSessionToken &&
            sessionKey !== null &&
            sessionKey === activeSessionKey
        );
    }

    function bindSessionWatchers(store: MailStore, session: RtcSession) {
        cleanupSessionWatchers();
        voiceActivated = false;

        const sessionKey = getSessionKey(session);
        if (!sessionKey) {
            activeSessionToken += 1;
            activeSessionKey = null;
            emitLifecycle({ hasRtcService: true, hasHostedCall: false, isTalking: false });
            emitCallState(null);
            return;
        }

        activeSessionToken += 1;
        activeSessionKey = sessionKey;
        const token = activeSessionToken;

        const emitSessionLifecycle = () => {
            if (!isCurrentSession(token, sessionKey)) {
                return;
            }
            emitLifecycle({
                hasRtcService: true,
                hasHostedCall: true,
                isTalking: Boolean(session.isTalking)
            });
        };

        const emitSessionState = () => {
            if (!isCurrentSession(token, sessionKey)) {
                return;
            }
            emitCallState({
                isMute: Boolean(session.isMute),
                isDeaf: Boolean(session.is_deaf),
                isCameraOn: Boolean(session.is_camera_on),
                isScreenOn: Boolean(session.is_screen_sharing_on)
            });
        };

        addSessionWatcherStop(store.onChange(session, "isTalking", emitSessionLifecycle));
        addSessionWatcherStop(store.onChange(session, "is_muted", emitSessionState));
        addSessionWatcherStop(store.onChange(session, "is_deaf", emitSessionState));
        addSessionWatcherStop(store.onChange(session, "is_camera_on", emitSessionState));
        addSessionWatcherStop(store.onChange(session, "is_screen_sharing_on", emitSessionState));

        emitSessionLifecycle();
        emitSessionState();
    }

    function handleLocalSessionChange() {
        const store = getStore();
        const rtc = store?.rtc;
        if (!store || !rtc) {
            activeSessionToken += 1;
            activeSessionKey = null;
            voiceActivated = false;
            cleanupSessionWatchers();
            emitLifecycle({ hasRtcService: false, hasHostedCall: false, isTalking: false });
            emitCallState(null);
            return;
        }

        const localSession = rtc.localSession;
        if (!localSession) {
            activeSessionToken += 1;
            activeSessionKey = null;
            voiceActivated = false;
            cleanupSessionWatchers();
            emitLifecycle({ hasRtcService: true, hasHostedCall: false, isTalking: false });
            emitCallState(null);
            return;
        }

        if (getSessionKey(localSession) === activeSessionKey && stopSessionWatchers.length > 0) {
            emitLifecycle({
                hasRtcService: true,
                hasHostedCall: true,
                isTalking: Boolean(localSession.isTalking)
            });
            emitCallState({
                isMute: Boolean(localSession.isMute),
                isDeaf: Boolean(localSession.is_deaf),
                isCameraOn: Boolean(localSession.is_camera_on),
                isScreenOn: Boolean(localSession.is_screen_sharing_on)
            });
            return;
        }

        bindSessionWatchers(store, localSession);
    }

    function tryAttachStoreWatcher(): boolean {
        if (stopRtcWatcher) {
            return true;
        }
        const store = getStore();
        if (!store?.rtc || typeof store.onChange !== "function") {
            return false;
        }
        const stopWatcher = store.onChange(store.rtc, "localSession", handleLocalSessionChange);
        if (typeof stopWatcher !== "function") {
            return false;
        }
        stopRtcWatcher = stopWatcher;
        handleLocalSessionChange();
        return true;
    }

    function setupBootstrapWatcher() {
        if (stopBootstrapWatcher) {
            return;
        }

        const tryAttach = () => {
            if (!storeWatchRunning) {
                return;
            }
            if (!tryAttachStoreWatcher()) {
                return;
            }
            cleanupBootstrapWatcher();
        };

        const onReadyStateChange = () => {
            tryAttach();
        };

        const observer = new MutationObserver(() => {
            tryAttach();
        });
        observer.observe(document.documentElement ?? document, { childList: true, subtree: true });
        document.addEventListener("readystatechange", onReadyStateChange);

        stopBootstrapWatcher = () => {
            observer.disconnect();
            document.removeEventListener("readystatechange", onReadyStateChange);
        };

        emitLifecycle({ hasRtcService: false, hasHostedCall: false, isTalking: false });
        emitCallState(null);
        tryAttach();
    }

    function startStoreWatch() {
        storeWatchRunning = true;
        if (!tryAttachStoreWatcher()) {
            setupBootstrapWatcher();
        }
        return {
            running: true,
            hasRtcService: Boolean(getRtc())
        };
    }

    function stopStoreWatch() {
        storeWatchRunning = false;
        voiceActivated = false;
        cleanupBootstrapWatcher();
        cleanupSessionWatchers();
        if (stopRtcWatcher) {
            stopRtcWatcher();
            stopRtcWatcher = null;
        }
        activeSessionToken += 1;
        activeSessionKey = null;
        emitLifecycle({ hasRtcService: Boolean(getRtc()), hasHostedCall: false, isTalking: false });
        emitCallState(null);
        return { running: false };
    }

    function openChannelInTab(): boolean {
        const rtc = getRtc();
        if (!rtc?.channel) {
            return false;
        }
        rtc.channel.open();
        return true;
    }

    async function toggleMicrophoneInTab(): Promise<boolean> {
        const rtc = getRtc();
        if (!rtc?.localSession) {
            return false;
        }
        await rtc.toggleMicrophone();
        return true;
    }

    async function toggleDeafenInTab(): Promise<boolean> {
        const rtc = getRtc();
        if (!rtc?.localSession) {
            return false;
        }
        await rtc.toggleDeafen();
        return true;
    }

    async function toggleCameraInTab(): Promise<boolean> {
        const rtc = getRtc();
        if (!rtc?.localSession) {
            return false;
        }
        await rtc.toggleVideo("camera");
        return true;
    }

    async function toggleScreenInTab(): Promise<boolean> {
        const rtc = getRtc();
        if (!rtc?.localSession) {
            return false;
        }
        await rtc.toggleVideo("screen");
        return true;
    }

    async function openPipInTab(): Promise<boolean> {
        const rtc = getRtc();
        if (!rtc?.localSession || !rtc.pipService) {
            return false;
        }
        await rtc.openPip({});
        return true;
    }

    async function leaveCallInTab(): Promise<boolean> {
        const rtc = getRtc();
        if (!rtc?.localSession || !rtc.leaveCall) {
            return false;
        }
        await rtc.leaveCall();
        return true;
    }

    async function setMuteInTab(value: boolean): Promise<boolean> {
        const rtc = getRtc();
        const localSession = rtc?.localSession;
        if (!localSession) {
            return false;
        }
        if (localSession.isMute !== value) {
            await rtc.toggleMicrophone();
        }
        return true;
    }

    async function setDeafInTab(value: boolean): Promise<boolean> {
        const rtc = getRtc();
        const localSession = rtc?.localSession;
        if (!localSession) {
            return false;
        }
        if (localSession.is_deaf !== value) {
            await rtc.toggleDeafen();
        }
        return true;
    }

    async function setCameraInTab(value: boolean): Promise<boolean> {
        const rtc = getRtc();
        const localSession = rtc?.localSession;
        if (!localSession) {
            return false;
        }
        if (localSession.is_camera_on !== value) {
            await rtc.toggleVideo("camera");
        }
        return true;
    }

    async function setScreenInTab(value: boolean): Promise<boolean> {
        const rtc = getRtc();
        const localSession = rtc?.localSession;
        if (!localSession) {
            return false;
        }
        if (localSession.is_screen_sharing_on !== value) {
            await rtc.toggleVideo("screen");
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

    function runPttCommand(command: PttCommand): boolean {
        const rtc = getRtc();
        if (!rtc?.localSession) {
            return false;
        }
        switch (command) {
            case "ptt-down":
                voiceActivated = false;
                rtc.onPushToTalk();
                return true;
            case "ptt-up":
                if (!voiceActivated) {
                    rtc.setPttReleaseTimeout();
                }
                return true;
            case "toggle-voice":
                if (voiceActivated) {
                    rtc.setPttReleaseTimeout(0);
                } else {
                    rtc.onPushToTalk();
                }
                voiceActivated = !voiceActivated;
                return true;
            default:
                return false;
        }
    }

    function getCallInfo() {
        const channel = getRtc()?.channel;
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
            case "start-store-watch": {
                return buildResponse(requestId, true, startStoreWatch());
            }
            case "stop-store-watch": {
                return buildResponse(requestId, true, stopStoreWatch());
            }
            case "ptt-command": {
                const command = (payload as { command?: PttCommand } | undefined)?.command;
                if (!command) {
                    return buildResponse(requestId, false, { error: "invalid-ptt-command" });
                }
                const didRun = runPttCommand(command);
                return buildResponse(requestId, true, { didRun });
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
