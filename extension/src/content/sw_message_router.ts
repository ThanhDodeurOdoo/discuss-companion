import type { CallState } from "../call_state_types";
import { SwToContentMessageType, isSwToContentMessage } from "../messaging/sw_channel";
import { WorkerSubscriptionState, type ContentRuntimeState } from "./runtime_state";

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
