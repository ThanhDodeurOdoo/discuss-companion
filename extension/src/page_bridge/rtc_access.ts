import type { CallState } from "@extension/src/call_state_types";
import type {
    OdooWindow,
    MailStore,
    RtcService,
    RtcSession
} from "@extension/src/page_bridge/runtime_types";
import type { PageBridgeRuntimeState } from "@extension/src/page_bridge/runtime_state";

const OWL_MODULE = "@odoo/owl";

type StopObservation = () => void;

type HostOwl = {
    effect: (callback: () => void) => StopObservation;
    proxy: <T extends object>(target: T) => T;
    untrack: <T>(callback: () => T) => T;
};

function isHostOwl(value: unknown): value is HostOwl {
    if (!value || typeof value !== "object") {
        return false;
    }
    const owl = value as Partial<HostOwl>;
    return (
        typeof owl.effect === "function" &&
        typeof owl.proxy === "function" &&
        typeof owl.untrack === "function"
    );
}

function hasRecordOnChange(target: object): boolean {
    return typeof (target as { onChange?: unknown }).onChange === "function";
}

export function createRtcAccess(win: OdooWindow, state: PageBridgeRuntimeState) {
    function getStore(): MailStore | undefined {
        return win.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    }

    function getRtc(): RtcService | undefined {
        return getStore()?.rtc;
    }

    function observeFields<T extends object>(
        target: T,
        fields: readonly Extract<keyof T, string>[],
        callback: () => void
    ): StopObservation | undefined {
        const hostOwl = win.odoo?.loader?.require(OWL_MODULE);
        if (isHostOwl(hostOwl)) {
            const reactiveTarget = hostOwl.proxy(target);
            let isInitialRun = true;
            return hostOwl.untrack(() =>
                hostOwl.effect(() => {
                    for (const field of fields) {
                        Reflect.get(reactiveTarget, field);
                    }
                    if (isInitialRun) {
                        isInitialRun = false;
                        return;
                    }
                    hostOwl.untrack(callback);
                })
            );
        }

        if (hasRecordOnChange(target)) {
            return undefined;
        }

        const store = getStore();
        if (!store) {
            return undefined;
        }
        const stops = fields.map((field) => store.onChange(target, field, callback));
        return () => {
            for (const stop of stops) {
                stop();
            }
        };
    }

    function readRtcVoiceActivated(rtc?: RtcService): boolean | null {
        const value = rtc?.pttExtService?.voiceActivated;
        return typeof value === "boolean" ? value : null;
    }

    function setVoiceActivated(value: boolean, rtc?: RtcService): void {
        state.voiceActivated = value;
        const targetRtc = rtc ?? getRtc();
        if (targetRtc?.pttExtService) {
            targetRtc.pttExtService.voiceActivated = value;
        }
    }

    function getVoiceActivated(rtc?: RtcService): boolean {
        const rtcValue = readRtcVoiceActivated(rtc);
        if (rtcValue === null) {
            return state.voiceActivated;
        }
        state.voiceActivated = rtcValue;
        return rtcValue;
    }

    async function stopTalkingAndDisableVoice(rtc?: RtcService): Promise<void> {
        const targetRtc = rtc ?? getRtc();
        if (!targetRtc) {
            setVoiceActivated(false);
            return;
        }
        setVoiceActivated(false, targetRtc);
        if (typeof targetRtc.setTalking === "function") {
            await targetRtc.setTalking(false);
            return;
        }
        targetRtc.setPttReleaseTimeout(0);
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

    function buildCallState(session: RtcSession, rtc?: RtcService): CallState {
        return {
            isMute: Boolean(session.isMute),
            isDeaf: Boolean(session.is_deaf),
            isCameraOn: Boolean(session.is_camera_on),
            isScreenOn: Boolean(session.is_screen_sharing_on),
            isVoiceActivated: getVoiceActivated(rtc)
        };
    }

    function readCallState(): CallState | null {
        const rtc = getRtc();
        const session = rtc?.localSession;
        if (!session) {
            return null;
        }
        return buildCallState(session, rtc);
    }

    function getCallInfo() {
        const channel = getRtc()?.channel;
        return {
            channelId: channel?.id,
            channelName: channel?.name,
            origin: window.location.origin
        };
    }

    return {
        getRtc,
        observeFields,
        setVoiceActivated,
        getVoiceActivated,
        stopTalkingAndDisableVoice,
        getSessionKey,
        buildCallState,
        readCallState,
        getCallInfo
    };
}
