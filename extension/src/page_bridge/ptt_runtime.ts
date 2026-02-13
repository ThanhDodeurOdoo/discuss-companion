import type { CallState } from "../call_state_types";
import type { PttCommand, RtcService } from "./runtime_types";

type PttAccess = {
    getRtc: () => RtcService | undefined;
    getVoiceActivated: (rtc?: RtcService) => boolean;
    setVoiceActivated: (value: boolean, rtc?: RtcService) => void;
    readCallState: () => CallState | null;
};

export function createPttRuntime(deps: {
    access: PttAccess;
    emitCallState: (state: CallState | null) => void;
}) {
    const { access, emitCallState } = deps;

    function runPttCommand(command: PttCommand): { didRun: boolean; state: CallState | null } {
        const rtc = access.getRtc();
        if (!rtc?.localSession) {
            return { didRun: false, state: null };
        }

        let voiceActivated = access.getVoiceActivated(rtc);
        let didRun = true;

        switch (command) {
            case "ptt-down":
                access.setVoiceActivated(false, rtc);
                rtc.onPushToTalk();
                break;
            case "ptt-up":
                if (!voiceActivated) {
                    rtc.setPttReleaseTimeout();
                }
                break;
            case "toggle-voice":
                if (voiceActivated) {
                    rtc.setPttReleaseTimeout(0);
                } else {
                    rtc.onPushToTalk();
                }
                voiceActivated = !voiceActivated;
                access.setVoiceActivated(voiceActivated, rtc);
                break;
            default:
                didRun = false;
        }

        const state = access.readCallState();
        if (didRun) {
            emitCallState(state);
        }

        return { didRun, state };
    }

    return {
        runPttCommand
    };
}
