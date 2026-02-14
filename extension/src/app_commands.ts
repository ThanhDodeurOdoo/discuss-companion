import {
    CALL_ACTION_APP_COMMANDS,
    type CallAction,
    isCallAction
} from "@extension/src/call_actions";

export type ParsedAppCommand = {
    name: string;
    value?: unknown;
};

function parseBooleanValue(value: unknown): boolean | undefined {
    if (value === true || value === false) {
        return value;
    }
    if (typeof value === "number") {
        if (value === 1) {
            return true;
        }
        if (value === 0) {
            return false;
        }
        return undefined;
    }
    if (typeof value !== "string") {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "on") {
        return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "off") {
        return false;
    }
    return undefined;
}

export function parseAppCommand(rawState?: string | null): ParsedAppCommand | null {
    if (!rawState) {
        return null;
    }
    const trimmed = rawState.trim();
    if (!trimmed) {
        return null;
    }
    if (trimmed.startsWith("{")) {
        try {
            const parsed = JSON.parse(trimmed) as { command?: unknown; value?: unknown };
            if (typeof parsed.command !== "string") {
                return null;
            }
            return { name: parsed.command, value: parsed.value };
        } catch {
            return null;
        }
    }
    const separatorMatch = trimmed.match(/^([a-z-]+)\s*[:=]\s*(.+)$/i);
    if (separatorMatch) {
        const name = separatorMatch[1];
        return { name, value: separatorMatch[2] };
    }

    return { name: trimmed };
}

export function resolveAppCommandAction(
    name: string,
    rawValue?: unknown,
    log?: (...args: unknown[]) => void
): CallAction | null {
    const definition = CALL_ACTION_APP_COMMANDS[name];
    if (!definition) {
        log?.("[BG] Unknown app command", name);
        return null;
    }
    if (definition.expectsValue) {
        const parsedValue = parseBooleanValue(rawValue);
        if (parsedValue === undefined) {
            log?.("[BG] Invalid app command value", name, rawValue);
            return null;
        }
        const action = { type: definition.actionType, value: parsedValue };
        if (!isCallAction(action)) {
            log?.("[BG] Invalid app command action", name, rawValue);
            return null;
        }
        return action;
    }
    const action = { type: definition.actionType };
    if (!isCallAction(action)) {
        log?.("[BG] Invalid app command action", name, rawValue);
        return null;
    }
    return action;
}
