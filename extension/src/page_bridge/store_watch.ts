import type { RtcSession, RtcService } from "@extension/src/page_bridge/runtime_types";
import type { PageBridgeRuntimeState } from "@extension/src/page_bridge/runtime_state";
import type { CallState } from "@extension/src/call_state_types";

type RtcAccess = {
    getRtc: () => RtcService | undefined;
    observeFields: <T extends object>(
        target: T,
        fields: readonly Extract<keyof T, string>[],
        callback: () => void
    ) => (() => void) | undefined;
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

    function addSessionWatcherStop(stop: (() => void) | undefined): void {
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

    function bindSessionWatchers(rtc: RtcService, session: RtcSession): void {
        cleanupSessionWatchers();
        access.setVoiceActivated(false, rtc);

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
                access.setVoiceActivated(false, rtc);
            }
            previousMute = isMute;
            emitCallState(access.buildCallState(session, rtc));
        };

        addSessionWatcherStop(access.observeFields(session, ["isTalking"], emitSessionLifecycle));
        addSessionWatcherStop(
            access.observeFields(
                session,
                ["is_muted", "is_deaf", "is_camera_on", "is_screen_sharing_on"],
                emitSessionState
            )
        );

        emitSessionLifecycle();
        emitSessionState();
    }

    function handleLocalSessionChange(): void {
        const rtc = access.getRtc();
        if (!rtc) {
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

        bindSessionWatchers(rtc, localSession);
    }

    function tryAttachStoreWatcher(): boolean {
        if (state.stopRtcWatcher) {
            return true;
        }

        const rtc = access.getRtc();
        if (!rtc) {
            return false;
        }

        const stopWatcher = access.observeFields(rtc, ["localSession"], handleLocalSessionChange);
        if (!stopWatcher) {
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
