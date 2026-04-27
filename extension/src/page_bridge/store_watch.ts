import type { MailStore, RtcSession, RtcService } from "@extension/src/page_bridge/runtime_types";
import type { PageBridgeRuntimeState } from "@extension/src/page_bridge/runtime_state";
import type { CallState } from "@extension/src/call_state_types";

type RtcAccess = {
    getStore: () => MailStore | undefined;
    getRtc: () => RtcService | undefined;
    setVoiceActivated: (value: boolean, rtc?: RtcService) => void;
    getSessionKey: (session?: RtcSession) => string | null;
    buildCallState: (session: RtcSession, rtc?: RtcService) => CallState;
};

export function createStoreWatchController(deps: {
    state: PageBridgeRuntimeState;
    access: RtcAccess;
    emitLifecycle: (payload: {
        hasRtcService: boolean;
        hasHostedCall: boolean;
        isTalking: boolean;
    }) => void;
    emitCallState: (state: CallState | null) => void;
}) {
    const { state, access, emitLifecycle, emitCallState } = deps;

    function cleanupSessionWatchers(): void {
        for (const stop of state.stopSessionWatchers.splice(0)) {
            stop();
        }
    }

    function addSessionWatcherStop(stop: (() => void) | void): void {
        if (typeof stop !== "function") {
            return;
        }
        state.stopSessionWatchers.push(stop);
    }

    function cleanupBootstrapWatcher(): void {
        if (!state.stopBootstrapWatcher) {
            return;
        }
        state.stopBootstrapWatcher();
        state.stopBootstrapWatcher = null;
    }

    function isCurrentSession(token: number, sessionKey: string | null): boolean {
        return (
            state.storeWatchRunning &&
            token === state.activeSessionToken &&
            sessionKey !== null &&
            sessionKey === state.activeSessionKey
        );
    }

    function bindSessionWatchers(store: MailStore, session: RtcSession): void {
        cleanupSessionWatchers();
        access.setVoiceActivated(false, store.rtc);

        const sessionKey = access.getSessionKey(session);
        if (!sessionKey) {
            state.activeSessionToken += 1;
            state.activeSessionKey = null;
            emitLifecycle({ hasRtcService: true, hasHostedCall: false, isTalking: false });
            emitCallState(null);
            return;
        }

        state.activeSessionToken += 1;
        state.activeSessionKey = sessionKey;
        const token = state.activeSessionToken;
        let previousMute = Boolean(session.isMute);

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
            const isMute = Boolean(session.isMute);
            if (isMute && !previousMute) {
                access.setVoiceActivated(false, store.rtc);
            }
            previousMute = isMute;
            emitCallState(access.buildCallState(session, store.rtc));
        };

        addSessionWatcherStop(store.onChange(session, "isTalking", emitSessionLifecycle));
        addSessionWatcherStop(store.onChange(session, "is_muted", emitSessionState));
        addSessionWatcherStop(store.onChange(session, "is_deaf", emitSessionState));
        addSessionWatcherStop(store.onChange(session, "is_camera_on", emitSessionState));
        addSessionWatcherStop(store.onChange(session, "is_screen_sharing_on", emitSessionState));

        emitSessionLifecycle();
        emitSessionState();
    }

    function handleLocalSessionChange(): void {
        const store = access.getStore();
        const rtc = store?.rtc;
        if (!store || !rtc) {
            state.activeSessionToken += 1;
            state.activeSessionKey = null;
            state.voiceActivated = false;
            cleanupSessionWatchers();
            emitLifecycle({ hasRtcService: false, hasHostedCall: false, isTalking: false });
            emitCallState(null);
            return;
        }

        const localSession = rtc.localSession;
        if (!localSession) {
            state.activeSessionToken += 1;
            state.activeSessionKey = null;
            access.setVoiceActivated(false, rtc);
            cleanupSessionWatchers();
            emitLifecycle({ hasRtcService: true, hasHostedCall: false, isTalking: false });
            emitCallState(null);
            return;
        }

        if (
            access.getSessionKey(localSession) === state.activeSessionKey &&
            state.stopSessionWatchers.length > 0
        ) {
            emitLifecycle({
                hasRtcService: true,
                hasHostedCall: true,
                isTalking: Boolean(localSession.isTalking)
            });
            emitCallState(access.buildCallState(localSession, rtc));
            return;
        }

        bindSessionWatchers(store, localSession);
    }

    function tryAttachStoreWatcher(): boolean {
        if (state.stopRtcWatcher) {
            return true;
        }

        const store = access.getStore();
        if (!store?.rtc || typeof store.onChange !== "function") {
            return false;
        }

        const stopWatcher = store.onChange(store.rtc, "localSession", handleLocalSessionChange);
        if (typeof stopWatcher !== "function") {
            return false;
        }

        state.stopRtcWatcher = stopWatcher;
        handleLocalSessionChange();
        return true;
    }

    function setupBootstrapWatcher(): void {
        if (state.stopBootstrapWatcher) {
            return;
        }

        const tryAttach = () => {
            if (!state.storeWatchRunning) {
                return;
            }
            if (!tryAttachStoreWatcher()) {
                return;
            }
            cleanupBootstrapWatcher();
        };

        const intervalId = window.setInterval(tryAttach, 1000);
        const onReadyStateChange = () => {
            tryAttach();
        };

        const observer = new MutationObserver(() => {
            tryAttach();
        });
        observer.observe(document.documentElement ?? document, { childList: true, subtree: true });
        document.addEventListener("readystatechange", onReadyStateChange);

        state.stopBootstrapWatcher = () => {
            observer.disconnect();
            document.removeEventListener("readystatechange", onReadyStateChange);
            window.clearInterval(intervalId);
        };

        emitLifecycle({ hasRtcService: false, hasHostedCall: false, isTalking: false });
        emitCallState(null);
        tryAttach();
    }

    function startStoreWatch() {
        state.storeWatchRunning = true;
        if (!tryAttachStoreWatcher()) {
            setupBootstrapWatcher();
        }
        return {
            running: true,
            hasRtcService: Boolean(access.getRtc())
        };
    }

    function stopStoreWatch() {
        state.storeWatchRunning = false;
        access.setVoiceActivated(false);
        cleanupBootstrapWatcher();
        cleanupSessionWatchers();

        if (state.stopRtcWatcher) {
            state.stopRtcWatcher();
            state.stopRtcWatcher = null;
        }

        state.activeSessionToken += 1;
        state.activeSessionKey = null;
        emitLifecycle({
            hasRtcService: Boolean(access.getRtc()),
            hasHostedCall: false,
            isTalking: false
        });
        emitCallState(null);
        return { running: false };
    }

    return {
        startStoreWatch,
        stopStoreWatch
    };
}
