import type { CallAction } from "../call_actions";
import type { CallState } from "../call_state_types";
import {
    BRIDGE_CHANNEL,
    type BridgeRequest,
    type BridgeRequestType,
    type BridgeResponse,
    isBridgeMessage
} from "../messaging/bridge_protocol";
import type { PttCommand } from "./runtime_types";

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
        switch (type as BridgeRequestType) {
            case "call-action": {
                const action = (payload as { action?: CallAction } | undefined)?.action;
                if (!action) {
                    return buildResponse(requestId, false, { error: "invalid-action" });
                }
                const didRun = await runAction(action);
                const state = readCallState();
                return buildResponse(requestId, true, { didRun, state });
            }
            case "read-call-state": {
                const state = readCallState();
                return buildResponse(requestId, true, { state });
            }
            case "start-store-watch": {
                return buildResponse(requestId, true, startStoreWatch());
            }
            case "stop-store-watch": {
                return buildResponse(requestId, true, stopStoreWatch());
            }
            case "ptt-command": {
                const command = (payload as { command?: PttCommand } | undefined)?.command;
                if (!command) {
                    return buildResponse(requestId, false, { error: "invalid-ptt-command" });
                }
                const result = runPttCommand(command);
                return buildResponse(requestId, true, result);
            }
            case "get-call-info": {
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
