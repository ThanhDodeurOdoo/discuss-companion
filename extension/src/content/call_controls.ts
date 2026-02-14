import {
    type CallAction,
    type CallActionOptions,
    type CallActionResult,
    isCallAction,
    requiresFocusCallTab
} from "../call_actions";
import { parseAppCommand, resolveAppCommandAction } from "../app_commands";
import type { CallState } from "../call_state_types";
import type { BridgeClient } from "../messaging/bridge_client";
import { BridgeRequestType } from "../messaging/bridge_protocol";
import { ContentToSwMessageType, SwToContentMessageType } from "../messaging/sw_channel";
import { PttCommand } from "../page_bridge/runtime_types";
import { parseWsMessage } from "../ws/ws_codec";
import { isCallStateObserverPayload, isPttCommandPayload } from "../type_guards";
import type { ContentRuntimeState } from "./runtime_state";

export type SendToServiceWorker = <T>(message: {
    type: ContentToSwMessageType;
    value?: unknown;
}) => Promise<T | null>;

/**
 * Builds the call-controls runtime for content context command handling.
 *
 * This runtime is the command execution boundary that normalizes requests from:
 * - service-worker forwarded actions,
 * - native app websocket frames,
 * - page-bridge call-state events.
 *
 * Core invariant: whenever a command path yields a new call state, the runtime
 * updates the local cache and attempts to propagate the snapshot back to the
 * native app so UI/app state converge.
 */
export function createCallControlsRuntime(deps: {
    state: ContentRuntimeState;
    bridge: BridgeClient;
    ensureBridgeReady: () => Promise<void>;
    updateCachedCallState: (
        state: CallState | null,
        options?: { forcePersist?: boolean }
    ) => Promise<void>;
    sendCallStateToApp: (state?: CallState | null) => Promise<void>;
    refreshAndSendCallState: () => Promise<CallState | null>;
    sendToServiceWorker: SendToServiceWorker;
    log: (...args: unknown[]) => void;
}) {
    const {
        bridge,
        ensureBridgeReady,
        updateCachedCallState,
        sendCallStateToApp,
        refreshAndSendCallState,
        sendToServiceWorker,
        log
    } = deps;

    /**
     * Executes a call action through the page bridge and synchronizes resulting state.
     *
     * Focus-sensitive actions can request a tab focus first via the worker.
     * After execution, any returned state is persisted in cache and forwarded to
     * the app transport layer.
     */
    async function runCallAction(
        action: CallAction,
        options: CallActionOptions = {}
    ): Promise<CallActionResult> {
        if (requiresFocusCallTab(action) || options.focusCallTab) {
            await sendToServiceWorker({ type: ContentToSwMessageType.FocusCallTab });
        }
        await ensureBridgeReady();
        const response = await bridge.request<{ didRun?: boolean; state?: CallState | null }>(
            BridgeRequestType.CallAction,
            { action }
        );
        const didRun = Boolean(response?.didRun);
        const state = response?.state ?? null;
        if (response) {
            await updateCachedCallState(state);
        }
        await sendCallStateToApp(state);
        return { didRun, state: state ?? undefined };
    }

    /**
     * Sends a PTT command through the bridge and syncs resulting state.
     *
     * Returns `null` when the bridge did not provide a response (request timeout
     * or unavailable bridge), allowing callers to return a command-failed error.
     */
    async function sendPttCommand(
        command: PttCommand
    ): Promise<{ didRun: boolean; state?: CallState } | null> {
        await ensureBridgeReady();
        const response = await bridge.request<{ didRun?: boolean; state?: CallState | null }>(
            BridgeRequestType.PttCommand,
            { command }
        );
        if (!response) {
            return null;
        }
        const didRun = Boolean(response.didRun);
        const state = response.state ?? null;
        await updateCachedCallState(state);
        await sendCallStateToApp(state);
        return { didRun, state: state ?? undefined };
    }

    /**
     * Handles `status` commands received from the app websocket.
     *
     * Supported commands are mapped to either:
     * - worker-level focus requests,
     * - state refresh requests,
     * - resolved call actions.
     */
    async function handleStatusState(rawState?: string | null): Promise<void> {
        const command = parseAppCommand(rawState);
        if (!command) {
            return;
        }
        if (command.name === "focus-call-tab" || command.name === "go-to-call") {
            await sendToServiceWorker({ type: ContentToSwMessageType.FocusCallTab });
            await sendCallStateToApp();
            return;
        }
        if (command.name === "refresh-call-state") {
            await refreshAndSendCallState();
            return;
        }
        const action = resolveAppCommandAction(command.name, command.value, log);
        if (!action) {
            return;
        }
        await runCallAction(action);
    }

    /**
     * Dispatches decoded websocket frames into the appropriate command path.
     *
     * PTT frames trigger bridge PTT commands; status frames route through app
     * command parsing. Pong frames are acknowledged implicitly by transport
     * liveness and require no state mutation here.
     */
    function handleWsMessage(data: Uint8Array): void {
        const message = parseWsMessage(data);
        if (!message) {
            return;
        }
        switch (message.type) {
            case "ptt-down":
                void sendPttCommand(PttCommand.PttDown);
                break;
            case "ptt-up":
                void sendPttCommand(PttCommand.PttUp);
                break;
            case "status":
                void handleStatusState(message.state);
                break;
            case "pong":
                break;
        }
    }

    /**
     * Applies call-state events coming from page-bridge observers.
     *
     * Bridge events are considered authoritative snapshots of in-page call
     * state; they refresh cache first and then are forwarded to the app channel.
     */
    function handleBridgeCallStateEvent(payload: unknown): void {
        if (!isCallStateObserverPayload(payload)) {
            return;
        }
        const nextState = payload.hasState ? (payload.state ?? null) : null;
        void updateCachedCallState(nextState).then(() => sendCallStateToApp(nextState));
    }

    /**
     * Handles service-worker forwarded command messages.
     *
     * The function mirrors service-worker request semantics:
     * - returns `true` when response is produced asynchronously,
     * - returns `false` for unknown/invalid messages handled synchronously.
     *
     * This allows the upstream listener to preserve `sendResponse` only for
     * branches that need async completion.
     */
    function handleContentMessage(
        request: unknown,
        sendResponse?: (response?: unknown) => void
    ): boolean {
        if (!request || typeof request !== "object") {
            return false;
        }
        const typed = request as { type?: unknown; value?: unknown };
        switch (typed.type) {
            case SwToContentMessageType.ContentCallAction:
                if (!isCallAction((typed.value as { action?: unknown } | null)?.action)) {
                    sendResponse?.({ error: "invalid-action" });
                    return false;
                }
                void runCallAction(
                    (typed.value as { action: CallAction }).action,
                    (typed.value as { options?: CallActionOptions }).options
                ).then((result) => {
                    sendResponse?.({ status: "ok", didRun: result.didRun, state: result.state });
                });
                return true;
            case SwToContentMessageType.ContentRefreshCallState:
                void refreshAndSendCallState().then((state) => {
                    sendResponse?.({ status: "ok", state });
                });
                return true;
            case SwToContentMessageType.ContentPttCommand:
                if (!isPttCommandPayload(typed.value)) {
                    sendResponse?.({ error: "invalid-command" });
                    return false;
                }
                void sendPttCommand(typed.value.command).then((result) => {
                    if (!result) {
                        sendResponse?.({ error: "command-failed" });
                        return;
                    }
                    sendResponse?.({ status: "ok", didRun: result.didRun, state: result.state });
                });
                return true;
            default:
                return false;
        }
    }

    return {
        runCallAction,
        sendPttCommand,
        handleWsMessage,
        handleBridgeCallStateEvent,
        handleContentMessage
    };
}
