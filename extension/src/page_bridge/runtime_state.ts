export type PageBridgeRuntimeState = {
    lastLifecycleSignature: string;
    lastCallStateSignature: string;
    stopRtcWatcher: (() => void) | null;
    stopSessionWatchers: Array<() => void>;
    stopBootstrapWatcher: (() => void) | null;
    storeWatchRunning: boolean;
    activeSessionToken: number;
    activeSessionKey: string | null;
    voiceActivated: boolean;
};

export function createPageBridgeRuntimeState(): PageBridgeRuntimeState {
    return {
        lastLifecycleSignature: "",
        lastCallStateSignature: "",
        stopRtcWatcher: null,
        stopSessionWatchers: [],
        stopBootstrapWatcher: null,
        storeWatchRunning: false,
        activeSessionToken: 0,
        activeSessionKey: null,
        voiceActivated: false
    };
}
