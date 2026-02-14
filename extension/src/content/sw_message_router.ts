import type { CallState } from "@extension/src/call_state_types";
import { SwToContentMessageType, isSwToContentMessage } from "@extension/src/messaging/sw_channel";
import {
    WorkerSubscriptionState,
    type ContentRuntimeState
} from "@extension/src/content/runtime_state";

/**
 * Registers service-worker -> content message routing for subscription and
 * ownership orchestration.
 *
 * This router is responsible for applying worker authority decisions inside the
 * content runtime:
 * - whether this tab is currently subscribed to call lifecycle handling,
 * - whether this tab is the active owner for native app connectivity,
 * - when local caches/WS connections must be initialized or torn down.
 *
 * Messages not consumed by the subscription/ownership state machine are
 * delegated to `handleContentMessage`, allowing command handlers to share one
 * runtime listener without coupling to worker coordination details.
 */
export function registerSwMessageRouter(deps: {
    state: ContentRuntimeState;
    ensureBridgeReady: () => Promise<void>;
    refreshWsConnection: () => void;
    refreshAndSendCallState: () => Promise<CallState | null>;
    sendCallStateToApp: (state?: CallState | null) => Promise<void>;
    updateCachedCallState: (
        state: CallState | null,
        options?: { forcePersist?: boolean }
    ) => Promise<void>;
    clearCallInfoCapture: () => void;
    disconnectWs: () => void;
    scheduleLifecycleResync: (delayMs?: number) => void;
    hasHostedCall: () => boolean;
    hasLastLifecyclePayload: () => boolean;
    handleContentMessage: (
        request: unknown,
        sendResponse?: (response?: unknown) => void
    ) => boolean;
}) {
    const {
        state,
        ensureBridgeReady,
        refreshWsConnection,
        refreshAndSendCallState,
        sendCallStateToApp,
        updateCachedCallState,
        clearCallInfoCapture,
        disconnectWs,
        scheduleLifecycleResync,
        hasHostedCall,
        hasLastLifecyclePayload,
        handleContentMessage
    } = deps;

    /**
     * Applies subscription/owner transitions emitted by the service worker.
     *
     * Transition rules:
     * - `owner && subscribed`: ensure page bridge readiness, connect WS if allowed,
     *   and publish a fresh call-state snapshot to keep app and storage aligned.
     * - losing subscription: clear call-info capture, disconnect WS, and when we
     *   were the active owner/subscriber, explicitly flush null state to avoid
     *   stale call-state persistence.
     *
     * This function is idempotent for repeated transitions with no effective
     * state change.
     */
    async function applySubscriptionChange(nextOwner: boolean, subscribed: boolean): Promise<void> {
        const wasOwner = state.isOwner;
        const wasSubscribed = state.isSubscribed;
        if (wasOwner === nextOwner && wasSubscribed === subscribed) {
            return;
        }

        state.isOwner = nextOwner;
        state.isSubscribed = subscribed;
        state.workerSubscriptionState = subscribed
            ? WorkerSubscriptionState.Subscribed
            : WorkerSubscriptionState.Unsubscribed;

        if (state.isOwner && state.isSubscribed) {
            await ensureBridgeReady();
            refreshWsConnection();
            await refreshAndSendCallState();
            return;
        }

        if (wasOwner && wasSubscribed && !subscribed) {
            await sendCallStateToApp(null);
            await updateCachedCallState(null, { forcePersist: true });
        }
        if (!subscribed) {
            clearCallInfoCapture();
        }

        disconnectWs();
    }

    /**
     * Single ingress for worker-directed content messages.
     *
     * Ownership/subscription messages are handled locally here. Other message
     * types are forwarded to runtime-specific handlers (call actions/PTT/state
     * refresh). On unsubscribe, a zero-delay lifecycle resync is scheduled when
     * we still have hosted-call evidence, ensuring eventual consistency if an
     * ownership transition races with lifecycle propagation.
     */
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
        if (!isSwToContentMessage(request)) {
            return;
        }

        switch (request.type) {
            case SwToContentMessageType.ContentSubscribe:
                void applySubscriptionChange(request.value.isOwner, true);
                break;
            case SwToContentMessageType.ContentUnsubscribe:
                void applySubscriptionChange(false, false).then(() => {
                    if (hasHostedCall() && hasLastLifecyclePayload()) {
                        scheduleLifecycleResync(0);
                    }
                });
                break;
            case SwToContentMessageType.ContentOwnerUpdate:
                void applySubscriptionChange(request.value.isOwner, true);
                break;
            default:
                return handleContentMessage(request, sendResponse);
        }

        return false;
    });
}
