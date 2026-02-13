import { createCallActionRunner } from "./call_actions";
import { createBridgeEventEmitter } from "./event_emitter";
import { createPttRuntime } from "./ptt_runtime";
import { createBridgeRequestRouter } from "./request_router";
import { createRtcAccess } from "./rtc_access";
import { createPageBridgeRuntimeState } from "./runtime_state";
import { createStoreWatchController } from "./store_watch";
import type { OdooWindow } from "./runtime_types";

const BRIDGE_MARKER = "__DISCUSS_COMPANION_PAGE_BRIDGE_INSTALLED__";

export function startPageBridgeRuntime(): void {
    const win = window as OdooWindow;
    const markerStore = win as unknown as Record<string, boolean | undefined>;
    if (markerStore[BRIDGE_MARKER]) {
        return;
    }
    markerStore[BRIDGE_MARKER] = true;

    const state = createPageBridgeRuntimeState();
    const access = createRtcAccess(win, state);
    const emitter = createBridgeEventEmitter(state);
    const storeWatch = createStoreWatchController({
        state,
        access,
        emitLifecycle: emitter.emitLifecycle,
        emitCallState: emitter.emitCallState
    });
    const callActions = createCallActionRunner(access);
    const pttRuntime = createPttRuntime({
        access,
        emitCallState: emitter.emitCallState
    });

    const requestRouter = createBridgeRequestRouter({
        runAction: callActions.runAction,
        readCallState: access.readCallState,
        startStoreWatch: storeWatch.startStoreWatch,
        stopStoreWatch: storeWatch.stopStoreWatch,
        runPttCommand: pttRuntime.runPttCommand,
        getCallInfo: access.getCallInfo
    });

    requestRouter.registerMessageListener();
}
