import type { CallState } from "@extension/src/call_state_types";
import type {
    OdooWindow,
    MailStore,
    RtcService,
    RtcSession
} from "@extension/src/page_bridge/runtime_types";
import type { PageBridgeRuntimeState } from "@extension/src/page_bridge/runtime_state";

export function createRtcAccess(win: OdooWindow, state: PageBridgeRuntimeState) {
    function getStore(): MailStore | undefined {
        return win.odoo?.__WOWL_DEBUG__?.root.env.services["mail.store"];
    }

    function getRtc(): RtcService | undefined {
        return getStore()?.rtc;
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
        getStore,
        getRtc,
        setVoiceActivated,
        getVoiceActivated,
        stopTalkingAndDisableVoice,
        getSessionKey,
        buildCallState,
        readCallState,
        getCallInfo
    };
}
