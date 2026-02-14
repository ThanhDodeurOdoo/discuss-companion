import type { CallAction } from "../call_actions";
import type { CallState } from "../call_state_types";
import {
    BRIDGE_CHANNEL,
    type BridgeRequest,
    BridgeRequestType,
    type BridgeResponse,
    isBridgeMessage
} from "../messaging/bridge_protocol";
import { isPttCommand, type PttCommand } from "./runtime_types";

export function createBridgeRequestRouter(deps: {
    runAction: (action: CallAction) => Promise<boolean>;
    readCallState: () => CallState | null;
    startStoreWatch: () => { running: boolean; hasRtcService?: boolean };
    stopStoreWatch: () => { running: boolean };
    runPttCommand: (command: PttCommand) => { didRun: boolean; state: CallState | null };
    getCallInfo: () => { channelId?: number; channelName?: string; origin: string };
}) {
    const {
        runAction,
        readCallState,
        startStoreWatch,
        stopStoreWatch,
        runPttCommand,
        getCallInfo
    } = deps;

    function buildResponse(requestId: string, ok: boolean, payload?: unknown): BridgeResponse {
        return {
            channel: BRIDGE_CHANNEL,
            kind: "response",
            requestId,
            ok,
            payload
        };
    }

    async function handleRequest(request: BridgeRequest): Promise<BridgeResponse> {
        const { requestId, type, payload } = request;
        switch (type) {
            case BridgeRequestType.CallAction: {
                const action = (payload as { action?: CallAction } | undefined)?.action;
                if (!action) {
                    return buildResponse(requestId, false, { error: "invalid-action" });
                }
                const didRun = await runAction(action);
                const state = readCallState();
                return buildResponse(requestId, true, { didRun, state });
            }
            case BridgeRequestType.ReadCallState: {
                const state = readCallState();
                return buildResponse(requestId, true, { state });
            }
            case BridgeRequestType.StartStoreWatch: {
                return buildResponse(requestId, true, startStoreWatch());
            }
            case BridgeRequestType.StopStoreWatch: {
                return buildResponse(requestId, true, stopStoreWatch());
            }
            case BridgeRequestType.PttCommand: {
                const command = (payload as { command?: unknown } | undefined)?.command;
                if (!isPttCommand(command)) {
                    return buildResponse(requestId, false, { error: "invalid-ptt-command" });
                }
                const result = runPttCommand(command);
                return buildResponse(requestId, true, result);
            }
            case BridgeRequestType.GetCallInfo: {
                return buildResponse(requestId, true, getCallInfo());
            }
            default:
                return buildResponse(requestId, false, { error: "unknown-request" });
        }
    }

    function registerMessageListener(): void {
        window.addEventListener("message", (event) => {
            if (event.source !== window || event.origin !== location.origin) {
                return;
            }
            if (!isBridgeMessage(event.data)) {
                return;
            }
            const message = event.data;
            if (message.kind !== "request") {
                return;
            }
            void handleRequest(message as BridgeRequest).then((response) => {
                window.postMessage(response, location.origin);
            });
        });
    }

    return {
        registerMessageListener
    };
}
