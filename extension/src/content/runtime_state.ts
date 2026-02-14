import type { CallState } from "../call_state_types";
import type { CallLifecycleObserverPayload } from "../type_guards";

export const BRIDGE_SCRIPT_ID = "__discuss_companion_page_bridge__";
export const CALL_INFO_CAPTURE_DELAY = 3000;
export const LIFECYCLE_RESYNC_DELAY = 1000;

const mutedLog = (..._args: unknown[]) => {};

export enum WorkerSubscriptionState {
    Unknown = "unknown",
    Subscribed = "subscribed",
    Unsubscribed = "unsubscribed"
}

export type ContentRuntimeState = {
    wsPort: number;
    isCompanionEnabled: boolean;
    isOwner: boolean;
    isSubscribed: boolean;
    hasHostedCall: boolean;
    hasStartedStoreWatch: boolean;
    bridgeReady: Promise<void> | null;
    lifecycleQueue: Promise<void>;
    cachedCallState: CallState | null;
    callInfoCaptureTimeoutId: number | null;
    lifecycleResyncTimeoutId: number | null;
    lastLifecyclePayload: CallLifecycleObserverPayload | null;
    workerSubscriptionState: WorkerSubscriptionState;
    logTarget: (...args: unknown[]) => void;
};

export function createContentRuntimeState(): ContentRuntimeState {
    return {
        wsPort: 49152,
        isCompanionEnabled: false,
        isOwner: false,
        isSubscribed: false,
        hasHostedCall: false,
        hasStartedStoreWatch: false,
        bridgeReady: null,
        lifecycleQueue: Promise.resolve(),
        cachedCallState: null,
        callInfoCaptureTimeoutId: null,
        lifecycleResyncTimeoutId: null,
        lastLifecyclePayload: null,
        workerSubscriptionState: WorkerSubscriptionState.Unknown,
        logTarget: mutedLog
    };
}

export function createLogger(state: ContentRuntimeState) {
    return (...args: unknown[]) => state.logTarget(...args);
}
