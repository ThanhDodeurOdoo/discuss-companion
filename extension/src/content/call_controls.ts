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
import { parseWsMessage } from "../ws/ws_codec";
import { isCallStateObserverPayload, isPttCommandPayload } from "../type_guards";
import type { ContentRuntimeState } from "./runtime_state";

export type SendToServiceWorker = <T>(message: {
    type: string;
    value?: unknown;
}) => Promise<T | null>;

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

    async function runCallAction(
        action: CallAction,
        options: CallActionOptions = {}
    ): Promise<CallActionResult> {
        if (requiresFocusCallTab(action) || options.focusCallTab) {
            await sendToServiceWorker({ type: "focus-call-tab" });
        }
        await ensureBridgeReady();
        const response = await bridge.request<{ didRun?: boolean; state?: CallState | null }>(
            "call-action",
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

    async function sendPttCommand(
        command: "ptt-down" | "ptt-up" | "toggle-voice"
    ): Promise<{ didRun: boolean; state?: CallState } | null> {
        await ensureBridgeReady();
        const response = await bridge.request<{ didRun?: boolean; state?: CallState | null }>(
            "ptt-command",
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

    async function handleStatusState(rawState?: string | null): Promise<void> {
        const command = parseAppCommand(rawState);
        if (!command) {
            return;
        }
        if (command.name === "focus-call-tab" || command.name === "go-to-call") {
            await sendToServiceWorker({ type: "focus-call-tab" });
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

    function handleWsMessage(data: Uint8Array): void {
        const message = parseWsMessage(data);
        if (!message) {
            return;
        }
        switch (message.type) {
            case "ptt-down":
                void sendPttCommand("ptt-down");
                break;
            case "ptt-up":
                void sendPttCommand("ptt-up");
                break;
            case "status":
                void handleStatusState(message.state);
                break;
            case "pong":
                break;
        }
    }

    function handleBridgeCallStateEvent(payload: unknown): void {
        if (!isCallStateObserverPayload(payload)) {
            return;
        }
        const nextState = payload.hasState ? (payload.state ?? null) : null;
        void updateCachedCallState(nextState).then(() => sendCallStateToApp(nextState));
    }

    function handleContentMessage(
        request: unknown,
        sendResponse?: (response?: unknown) => void
    ): boolean {
        if (!request || typeof request !== "object") {
            return false;
        }
        const typed = request as { type?: unknown; value?: unknown };
        switch (typed.type) {
            case "content-call-action":
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
            case "content-refresh-call-state":
                void refreshAndSendCallState().then((state) => {
                    sendResponse?.({ status: "ok", state });
                });
                return true;
            case "content-ptt-command":
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
