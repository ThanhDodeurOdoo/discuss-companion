import { createCallActionRunner } from "@extension/src/page_bridge/call_actions";
import { createBridgeEventEmitter } from "@extension/src/page_bridge/event_emitter";
import { createPttRuntime } from "@extension/src/page_bridge/ptt_runtime";
import { createBridgeRequestRouter } from "@extension/src/page_bridge/request_router";
import { createRtcAccess } from "@extension/src/page_bridge/rtc_access";
import { createPageBridgeRuntimeState } from "@extension/src/page_bridge/runtime_state";
import { createStoreWatchController } from "@extension/src/page_bridge/store_watch";
import type { OdooWindow } from "@extension/src/page_bridge/runtime_types";

const BRIDGE_MARKER = "__DISCUSS_COMPANION_PAGE_BRIDGE_INSTALLED__";

/**
 * Initializes the page-bridge runtime (once per page).
 *
 * This entrypoint is the boundary adapter betwen:
 * - Odoo in-page runtime objects (store, RTC session, call actions),
 * - extension-side protocol messages coming from the content script.
 *
 * The bridge is deliberately split into narrow components so that each concern
 * (access, event emission, request routing, actions, PTT) can evolve without
 * tightly coupling to window messaging glue.
 *
 * Idempotency is mandatory: page scripts may be injected/reloaded more than
 * once, so we guard setup with a window marker and no-op on re-entry.
 */
export function startPageBridgeRuntime(): void {
    const win = window as OdooWindow;
    const markerStore = win as unknown as Record<string, boolean | undefined>;
    if (markerStore[BRIDGE_MARKER]) {
        return;
    }
    markerStore[BRIDGE_MARKER] = true;

    /**
     * Shared page-bridge state snapshott
     *
     * Holds local bridge bookkeeping needed by emiters/watchers and avoids
     * recomputing bridge-level metadata across independently composed modules.
     */
    const state = createPageBridgeRuntimeState();

    /**
     * Low-level access fasade around Odoo/window APIs.
     *
     * Normalizes reads/writes (call state, call info, actions) into a stable
     * interface so higher layers stay independent from Odoo internals.
     */
    const access = createRtcAccess(win, state);

    /**
     * Outbound protocol emitter for lifecycle/call-state updates.
     *
     * This is the only component that serializes bridge events onto window
     * messaging, giving one consistent event contract to content runtime.
     */
    const emitter = createBridgeEventEmitter(state);

    /**
     * Store/RTC watch controller.
     *
     * Starts and stops observation of Odoo state changes, then emits normalized
     * lifecycle + call-state events through `emitter`.
     */
    const storeWatch = createStoreWatchController({
        state,
        access,
        emitLifecycle: emitter.emitLifecycle,
        emitCallState: emitter.emitCallState
    });

    /**
     * Call action execution runtime.
     *
     * Converts protocol-level action requests into concrete Odoo action calls.
     */
    const callActions = createCallActionRunner(access);

    /**
     * Push-to-talk runtime.
     *
     * Handles PTT-specific request semantics and emits resulting call-state
     * updates so external consumers stay synchronized.
     */
    const pttRuntime = createPttRuntime({
        access,
        emitCallState: emitter.emitCallState
    });

    /**
     * Inbound protocol router.
     *
     * Maps message types from content runtime to explicit capability handlers.
     * Passing a flat capability set keeps routing deterministic and prevents the
     * router from depending on implementation details of each subsystem.
     */
    const requestRouter = createBridgeRequestRouter({
        runAction: callActions.runAction,
        readCallState: access.readCallState,
        startStoreWatch: storeWatch.startStoreWatch,
        stopStoreWatch: storeWatch.stopStoreWatch,
        runPttCommand: pttRuntime.runPttCommand,
        getCallInfo: access.getCallInfo
    });

    /**
     * Final activation step.
     *
     * Attaches window message listener after all capabilities are initialized so
     * no inbound request can observe a partially constructed runtime.
     */
    requestRouter.registerMessageListener();
}
