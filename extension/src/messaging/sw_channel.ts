import type { CallAction, CallActionOptions } from "../call_actions";
import type { CallState } from "../call_state_types";

export type ContentSubscribeMessage = {
    type: "content-subscribe";
    value: { isOwner: boolean };
};

export type ContentUnsubscribeMessage = {
    type: "content-unsubscribe";
};

export type ContentOwnerUpdateMessage = {
    type: "content-owner-update";
    value: { isOwner: boolean };
};

export type ContentCallActionMessage = {
    type: "content-call-action";
    value: { action: CallAction; options?: CallActionOptions };
};

export type ContentRefreshCallStateMessage = {
    type: "content-refresh-call-state";
};

export type SwToContentMessage =
    | ContentSubscribeMessage
    | ContentUnsubscribeMessage
    | ContentOwnerUpdateMessage
    | ContentCallActionMessage
    | ContentRefreshCallStateMessage;

export type ContentConnectionStateMessage = {
    type: "content-connection-state";
    value: { isConnected: boolean };
};

export type ContentCallStateUpdateMessage = {
    type: "content-call-state-update";
    value: { state: CallState | null };
};

export type SwResponse<T> = T | { error: string };

const CONTENT_MESSAGE_TYPES = new Set([
    "content-subscribe",
    "content-unsubscribe",
    "content-owner-update",
    "content-call-action",
    "content-refresh-call-state"
]);

export function isSwToContentMessage(value: unknown): value is SwToContentMessage {
    if (!value || typeof value !== "object") {
        return false;
    }
    const message = value as { type?: unknown };
    return typeof message.type === "string" && CONTENT_MESSAGE_TYPES.has(message.type);
}

export function sendToServiceWorker<T>(message: {
    type: string;
    value?: unknown;
}): Promise<T | null> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (response: T) => {
            if (chrome.runtime.lastError) {
                console.warn(
                    "[Discuss Companion] Message failed",
                    chrome.runtime.lastError.message
                );
                resolve(null);
                return;
            }
            resolve(response ?? null);
        });
    });
}
