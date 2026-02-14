import type { CallAction } from "@extension/src/call_actions";
import type { RtcService } from "@extension/src/page_bridge/runtime_types";

type RtcAccess = {
    getRtc: () => RtcService | undefined;
    stopTalkingAndDisableVoice: (rtc?: RtcService) => Promise<void>;
};

export function createCallActionRunner(access: RtcAccess) {
    function openChannelInTab(): boolean {
        const rtc = access.getRtc();
        if (!rtc?.channel) {
            return false;
        }
        rtc.channel.open();
        return true;
    }

    async function toggleMicrophoneInTab(): Promise<boolean> {
        const rtc = access.getRtc();
        if (!rtc?.localSession) {
            return false;
        }
        const wasMuted = Boolean(rtc.localSession.isMute);
        await rtc.toggleMicrophone();
        if (!wasMuted) {
            await access.stopTalkingAndDisableVoice(rtc);
        }
        return true;
    }

    async function toggleDeafenInTab(): Promise<boolean> {
        const rtc = access.getRtc();
        if (!rtc?.localSession) {
            return false;
        }
        const wasDeaf = Boolean(rtc.localSession.is_deaf);
        await rtc.toggleDeafen();
        if (!wasDeaf) {
            await access.stopTalkingAndDisableVoice(rtc);
        }
        return true;
    }

    async function toggleCameraInTab(): Promise<boolean> {
        const rtc = access.getRtc();
        if (!rtc?.localSession) {
            return false;
        }
        await rtc.toggleVideo("camera");
        return true;
    }

    async function toggleScreenInTab(): Promise<boolean> {
        const rtc = access.getRtc();
        if (!rtc?.localSession) {
            return false;
        }
        await rtc.toggleVideo("screen");
        return true;
    }

    async function openPipInTab(): Promise<boolean> {
        const rtc = access.getRtc();
        if (!rtc?.localSession || !rtc.pipService) {
            return false;
        }
        await rtc.openPip({});
        return true;
    }

    async function leaveCallInTab(): Promise<boolean> {
        const rtc = access.getRtc();
        if (!rtc?.localSession || !rtc.leaveCall) {
            return false;
        }
        await rtc.leaveCall();
        return true;
    }

    async function setMuteInTab(value: boolean): Promise<boolean> {
        const rtc = access.getRtc();
        const localSession = rtc?.localSession;
        if (!localSession) {
            return false;
        }
        if (localSession.isMute !== value) {
            await rtc.toggleMicrophone();
            if (value) {
                await access.stopTalkingAndDisableVoice(rtc);
            }
        }
        return true;
    }

    async function setDeafInTab(value: boolean): Promise<boolean> {
        const rtc = access.getRtc();
        const localSession = rtc?.localSession;
        if (!localSession) {
            return false;
        }
        if (localSession.is_deaf !== value) {
            await rtc.toggleDeafen();
            if (value) {
                await access.stopTalkingAndDisableVoice(rtc);
            }
        }
        return true;
    }

    async function setCameraInTab(value: boolean): Promise<boolean> {
        const rtc = access.getRtc();
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
        const rtc = access.getRtc();
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

    return {
        runAction
    };
}
