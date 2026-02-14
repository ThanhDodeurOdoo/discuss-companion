import type { BridgeClient } from "@extension/src/messaging/bridge_client";
import { BridgeRequestType } from "@extension/src/messaging/bridge_protocol";
import {
    CALL_INFO_CAPTURE_DELAY,
    type ContentRuntimeState
} from "@extension/src/content/runtime_state";

export function createCallInfoCaptureController(deps: {
    state: ContentRuntimeState;
    ensureBridgeReady: () => Promise<void>;
    bridge: BridgeClient;
    log: (...args: unknown[]) => void;
}) {
    const { state, ensureBridgeReady, bridge, log } = deps;

    function clearCallInfoCapture(): void {
        if (state.callInfoCaptureTimeoutId === null) {
            return;
        }
        window.clearTimeout(state.callInfoCaptureTimeoutId);
        state.callInfoCaptureTimeoutId = null;
    }

    function scheduleCallInfoCapture(): void {
        clearCallInfoCapture();
        state.callInfoCaptureTimeoutId = window.setTimeout(async () => {
            state.callInfoCaptureTimeoutId = null;
            if (!state.hasHostedCall) {
                return;
            }
            try {
                await ensureBridgeReady();
                const info = await bridge.request<{
                    channelId?: number;
                    channelName?: string;
                    origin?: string;
                }>(BridgeRequestType.GetCallInfo);
                if (info?.channelId && info.origin) {
                    const url = new URL("/odoo/action-mail.action_discuss", info.origin);
                    url.searchParams.set("active_id", `discuss.channel_${info.channelId}`);
                    url.searchParams.set("call", "accept");
                    const lastJoinedCall = {
                        url: url.toString(),
                        name: info.channelName || "last call"
                    };
                    await chrome.storage.local.set({ lastJoinedCall });
                    log("[Content] Captured call info", lastJoinedCall);
                }
            } catch (error) {
                log("[Content] Failed to capture call info", error);
            }
        }, CALL_INFO_CAPTURE_DELAY);
    }

    return {
        clearCallInfoCapture,
        scheduleCallInfoCapture
    };
}
