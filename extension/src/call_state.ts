import type { CallState } from "./call_state_types";
import {
    getCallState,
    setCallState,
    getCallTabId as getStoredCallTabId,
    setCallTabId as setStoredCallTabId,
    getIsTalkingByTabId
} from "./storage/session_state";

export type { CallState };

export async function getStoredCallState(): Promise<CallState | undefined> {
    return getCallState();
}

export async function setStoredCallState(state?: CallState | null): Promise<void> {
    await setCallState(state ?? null);
}

export async function getCallTabId(): Promise<number | null> {
    return getStoredCallTabId();
}

export async function setCallTabId(tabId?: number | null): Promise<void> {
    await setStoredCallTabId(tabId);
}

function pickFirstTabId(isTalkingByTabId: Record<string, boolean>): number | null {
    const tabIds = Object.keys(isTalkingByTabId);
    if (tabIds.length === 0) {
        return null;
    }
    const tabId = Number(tabIds[0]);
    return Number.isNaN(tabId) ? null : tabId;
}

export async function resolveCallTabId(): Promise<number | null> {
    const storedTabId = await getCallTabId();
    if (storedTabId !== null) {
        return storedTabId;
    }
    const isTalkingByTabId = await getIsTalkingByTabId();
    const tabId = pickFirstTabId(isTalkingByTabId);
    if (tabId !== null) {
        await setCallTabId(tabId);
    }
    return tabId;
}
