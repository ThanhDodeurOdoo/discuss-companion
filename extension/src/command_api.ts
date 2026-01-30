import {
    executeCallAction,
    requiresUserGesture,
    type CallAction,
    type CallActionOptions,
    type CallActionResult
} from "./call_actions";
import type { CallState } from "./call_state";

type CallActionResponse = { status: "ok"; didRun: boolean; state?: CallState } | { error: string };

type CallStateResponse = { status: "ok"; state?: CallState } | { error: string };

type FocusResponse = { status: "ok"; didFocus: boolean } | { error: string };

// Some actions (like PiP) require a live user gesture and won't work from the service worker.
// We allow these to execute locally when the popup has focus; everything else is routed to the SW.
function canExecuteLocally() {
    return typeof document !== "undefined" && document.hasFocus();
}

function sendMessage<T>(message: { type: string; value?: unknown }): Promise<T | null> {
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

export async function requestCallAction(
    action: CallAction,
    options: CallActionOptions = {}
): Promise<CallActionResult | null> {
    if (requiresUserGesture(action) && canExecuteLocally()) {
        return executeCallAction(action, options);
    }
    const response = await sendMessage<CallActionResponse>({
        type: "call-action",
        value: { action, options }
    });
    if (!response || "error" in response) {
        return null;
    }
    return { didRun: response.didRun, state: response.state };
}

export async function requestCallState(): Promise<CallState | undefined> {
    const response = await sendMessage<CallStateResponse>({ type: "refresh-call-state" });
    if (!response || "error" in response) {
        return undefined;
    }
    return response.state;
}

export async function requestFocusCallTab(): Promise<boolean> {
    const response = await sendMessage<FocusResponse>({ type: "focus-call-tab" });
    if (!response || "error" in response) {
        return false;
    }
    return response.didFocus;
}
