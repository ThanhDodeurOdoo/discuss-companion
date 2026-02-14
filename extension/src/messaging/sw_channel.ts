import type { CallAction, CallActionOptions } from "@extension/src/call_actions";
import type { CallState } from "@extension/src/call_state_types";
import type { PttCommand } from "@extension/src/page_bridge/runtime_types";

export enum SwToContentMessageType {
    ContentSubscribe = "content-subscribe",
    ContentUnsubscribe = "content-unsubscribe",
    ContentOwnerUpdate = "content-owner-update",
    ContentCallAction = "content-call-action",
    ContentRefreshCallState = "content-refresh-call-state",
    ContentPttCommand = "content-ptt-command"
}

export enum ContentToSwMessageType {
    Subscribe = "subscribe",
    Unsubscribe = "unsubscribe",
    IsTalking = "is-talking",
    CallAction = "call-action",
    RefreshCallState = "refresh-call-state",
    PttCommand = "ptt-command",
    FocusCallTab = "focus-call-tab",
    ContentConnectionState = "content-connection-state",
    ContentCallStateUpdate = "content-call-state-update"
}

export type ContentSubscribeMessage = {
    type: SwToContentMessageType.ContentSubscribe;
    value: { isOwner: boolean };
};

export type ContentUnsubscribeMessage = {
    type: SwToContentMessageType.ContentUnsubscribe;
};

export type ContentOwnerUpdateMessage = {
    type: SwToContentMessageType.ContentOwnerUpdate;
    value: { isOwner: boolean };
};

export type ContentCallActionMessage = {
    type: SwToContentMessageType.ContentCallAction;
    value: { action: CallAction; options?: CallActionOptions };
};

export type ContentRefreshCallStateMessage = {
    type: SwToContentMessageType.ContentRefreshCallState;
};

export type ContentPttCommandMessage = {
    type: SwToContentMessageType.ContentPttCommand;
    value: { command: PttCommand };
};

export type SwToContentMessage =
    | ContentSubscribeMessage
    | ContentUnsubscribeMessage
    | ContentOwnerUpdateMessage
    | ContentCallActionMessage
    | ContentRefreshCallStateMessage
    | ContentPttCommandMessage;

export type ContentConnectionStateMessage = {
    type: ContentToSwMessageType.ContentConnectionState;
    value: { isConnected: boolean };
};

export type ContentCallStateUpdateMessage = {
    type: ContentToSwMessageType.ContentCallStateUpdate;
    value: { state: CallState | null };
};

export type SwResponse<T> = T | { error: string };

const CONTENT_MESSAGE_TYPES = new Set<string>(Object.values(SwToContentMessageType));

export function isSwToContentMessage(value: unknown): value is SwToContentMessage {
    if (!value || typeof value !== "object") {
        return false;
    }
    const message = value as { type?: unknown };
    return typeof message.type === "string" && CONTENT_MESSAGE_TYPES.has(message.type);
}

export function sendToServiceWorker<T>(message: {
    type: ContentToSwMessageType;
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
