import type { BridgeClient } from "../messaging/bridge_client";
import { injectScriptOnce } from "../utils/dom_inject";
import { BRIDGE_SCRIPT_ID, type ContentRuntimeState } from "./runtime_state";

export type BridgeWatchRuntime = {
    ensureBridgeReady: () => Promise<void>;
    maybeStartStoreWatch: () => Promise<void>;
    maybeStopStoreWatch: () => Promise<void>;
};

export function createBridgeWatchRuntime(
    state: ContentRuntimeState,
    bridge: BridgeClient,
    log: (...args: unknown[]) => void
): BridgeWatchRuntime {
    async function ensureBridgeReady(): Promise<void> {
        if (!state.bridgeReady) {
            state.bridgeReady = injectScriptOnce(
                chrome.runtime.getURL("page_bridge.js"),
                BRIDGE_SCRIPT_ID
            ).catch((error) => {
                log("[Content] Failed to inject page bridge", error);
                throw error;
            });
        }
        await state.bridgeReady;
    }

    async function maybeStartStoreWatch(): Promise<void> {
        if (state.hasStartedStoreWatch) {
            return;
        }
        await ensureBridgeReady();
        const result = await bridge.request<{ running?: boolean }>("start-store-watch");
        state.hasStartedStoreWatch = Boolean(result?.running);
    }

    async function maybeStopStoreWatch(): Promise<void> {
        if (!state.hasStartedStoreWatch) {
            return;
        }
        await ensureBridgeReady();
        const result = await bridge.request<{ running?: boolean }>("stop-store-watch");
        state.hasStartedStoreWatch = Boolean(result?.running);
    }

    return {
        ensureBridgeReady,
        maybeStartStoreWatch,
        maybeStopStoreWatch
    };
}
