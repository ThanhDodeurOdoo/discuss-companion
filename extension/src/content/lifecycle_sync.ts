import { LIFECYCLE_RESYNC_DELAY, type ContentRuntimeState } from "./runtime_state";
import { isCallLifecycleObserverPayload, type CallLifecycleObserverPayload } from "../type_guards";

export function createLifecycleSyncRuntime(deps: {
    state: ContentRuntimeState;
    log: (...args: unknown[]) => void;
    sendToServiceWorkerExpectOk: (message: { type: string; value?: unknown }) => Promise<boolean>;
    updateCachedCallState: (
        state: import("../call_state_types").CallState | null,
        options?: { forcePersist?: boolean }
    ) => Promise<void>;
    scheduleCallInfoCapture: () => void;
    clearCallInfoCapture: () => void;
    disconnectWs: () => void;
}) {
    const {
        state,
        log,
        sendToServiceWorkerExpectOk,
        updateCachedCallState,
        scheduleCallInfoCapture,
        clearCallInfoCapture,
        disconnectWs
    } = deps;

    function clearLifecycleResync(): void {
        if (state.lifecycleResyncTimeoutId === null) {
            return;
        }
        window.clearTimeout(state.lifecycleResyncTimeoutId);
        state.lifecycleResyncTimeoutId = null;
    }

    async function synchronizeLifecycleWithServiceWorker(
        payload: CallLifecycleObserverPayload
    ): Promise<boolean> {
        let ok = true;
        if (payload.hasHostedCall) {
            if (state.workerSubscriptionState !== "subscribed") {
                const subscribed = await sendToServiceWorkerExpectOk({ type: "subscribe" });
                ok = subscribed && ok;
                if (subscribed) {
                    state.workerSubscriptionState = "subscribed";
                }
            }
            const talkingUpdated = await sendToServiceWorkerExpectOk({
                type: "is-talking",
                value: payload.isTalking
            });
            ok = talkingUpdated && ok;
        } else {
            const talkingCleared = await sendToServiceWorkerExpectOk({
                type: "is-talking",
                value: false
            });
            ok = talkingCleared && ok;
            if (state.workerSubscriptionState !== "unsubscribed") {
                const unsubscribed = await sendToServiceWorkerExpectOk({ type: "unsubscribe" });
                ok = unsubscribed && ok;
                if (unsubscribed) {
                    state.workerSubscriptionState = "unsubscribed";
                }
            }
        }
        if (!ok) {
            state.workerSubscriptionState = "unknown";
        }
        return ok;
    }

    async function applyLifecycleUpdate(payload: unknown): Promise<void> {
        if (!isCallLifecycleObserverPayload(payload)) {
            return;
        }

        state.lastLifecyclePayload = payload;

        const hadHostedCall = state.hasHostedCall;
        state.hasHostedCall = payload.hasHostedCall;

        if (state.hasHostedCall && !hadHostedCall) {
            scheduleCallInfoCapture();
        }

        if (!state.hasHostedCall && hadHostedCall) {
            clearCallInfoCapture();
            await updateCachedCallState(null, { forcePersist: true });
        }
        if (!state.hasHostedCall) {
            clearCallInfoCapture();
        }

        const isLifecycleSynchronized = await synchronizeLifecycleWithServiceWorker(payload);
        if (!isLifecycleSynchronized) {
            scheduleLifecycleResync();
        } else {
            clearLifecycleResync();
        }

        if (!payload.hasRtcService && !payload.hasHostedCall) {
            disconnectWs();
        }
    }

    function queueLifecycleUpdate(payload: unknown): void {
        state.lifecycleQueue = state.lifecycleQueue
            .then(() => applyLifecycleUpdate(payload))
            .catch((error) => log("[Content] Failed to process lifecycle update", error));
    }

    function scheduleLifecycleResync(delayMs: number = LIFECYCLE_RESYNC_DELAY): void {
        if (state.lifecycleResyncTimeoutId !== null) {
            return;
        }
        state.lifecycleResyncTimeoutId = window.setTimeout(() => {
            state.lifecycleResyncTimeoutId = null;
            if (!state.lastLifecyclePayload) {
                return;
            }
            queueLifecycleUpdate(state.lastLifecyclePayload);
        }, delayMs);
    }

    return {
        queueLifecycleUpdate,
        scheduleLifecycleResync,
        clearLifecycleResync
    };
}
