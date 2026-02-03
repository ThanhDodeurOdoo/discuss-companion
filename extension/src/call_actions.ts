import type { CallState } from "./call_state_types";
import { CALL_ACTION_DEFINITIONS } from "./call_action_definitions";

const buildActionTypeMap = <T extends Record<string, { id: string }>>(actions: T) => {
    const result = {} as { [K in keyof T]: T[K]["id"] };
    for (const key of Object.keys(actions) as Array<keyof T>) {
        result[key] = actions[key].id;
    }
    return result;
};

const buildActionsById = <T extends Record<string, { id: string }>>(actions: T) => {
    const result: Record<string, T[keyof T]> = {};
    for (const key of Object.keys(actions) as Array<keyof T>) {
        const action = actions[key];
        result[action.id] = action;
    }
    return result as { [K in keyof T as T[K]["id"]]: T[K] };
};

export const CallActionType = buildActionTypeMap(CALL_ACTION_DEFINITIONS);

const CALL_ACTIONS_BY_ID = buildActionsById(CALL_ACTION_DEFINITIONS);

type CallActionDefinitionMap = typeof CALL_ACTIONS_BY_ID;

export type CallActionType = keyof CallActionDefinitionMap;

export type CallActionAppCommandDefinition = {
    actionType: CallActionType;
    expectsValue: boolean;
};

const buildAppCommandDefinitions = (definitions: CallActionDefinitionMap) => {
    const result: Record<string, CallActionAppCommandDefinition> = {};
    for (const actionType of Object.keys(definitions) as Array<CallActionType>) {
        const definition = definitions[actionType];
        const extraCommands = "appCommands" in definition ? definition.appCommands : undefined;
        const commandNames = new Set<string>([actionType, ...(extraCommands ?? [])]);
        for (const name of commandNames) {
            result[name] = {
                actionType,
                expectsValue: definition.requiresValue
            };
        }
    }
    return result;
};

export const CALL_ACTION_APP_COMMANDS = buildAppCommandDefinitions(CALL_ACTIONS_BY_ID);

type CallActionFor<T extends CallActionType> =
    CallActionDefinitionMap[T]["requiresValue"] extends true
        ? { type: T; value: boolean }
        : { type: T };

export type CallAction = { [T in CallActionType]: CallActionFor<T> }[CallActionType];

export type CallActionOptions = {
    focusCallTab?: boolean;
};

export type CallActionResult = {
    didRun: boolean;
    state?: CallState;
};

export function isCallAction(value: unknown): value is CallAction {
    if (!value || typeof value !== "object") {
        return false;
    }
    const action = value as { type?: unknown; value?: unknown };
    if (typeof action.type !== "string") {
        return false;
    }
    if (!Object.prototype.hasOwnProperty.call(CALL_ACTIONS_BY_ID, action.type)) {
        return false;
    }
    const definition = CALL_ACTIONS_BY_ID[action.type as CallActionType];
    if (definition.requiresValue) {
        return typeof action.value === "boolean";
    }
    return true;
}

export function requiresUserGesture(action: CallAction): boolean {
    return CALL_ACTIONS_BY_ID[action.type].requiresUserGesture === true;
}

export function requiresFocusCallTab(action: CallAction): boolean {
    const definition = CALL_ACTIONS_BY_ID[action.type] as { requiresFocusCallTab?: boolean };
    return definition.requiresFocusCallTab === true;
}
