import type { CallState } from "../call_state_types";

const CALL_STATE_KEY = "callState";
const CALL_TAB_ID_KEY = "callTabId";
const IS_TALKING_KEY = "isTalkingByTabId";
const APP_CONNECTED_KEY = "appConnected";

type SessionStorageSnapshot = {
    callState?: CallState | null;
    callTabId?: number | null;
    isTalkingByTabId?: Record<string, boolean>;
    appConnected?: boolean;
};

export async function getCallState(): Promise<CallState | undefined> {
    const { callState } = (await chrome.storage.session.get(
        CALL_STATE_KEY
    )) as SessionStorageSnapshot;
    return callState ?? undefined;
}

export async function setCallState(state?: CallState | null): Promise<void> {
    await chrome.storage.session.set({ callState: state ?? null });
}

export async function getCallTabId(): Promise<number | null> {
    const { callTabId } = (await chrome.storage.session.get(
        CALL_TAB_ID_KEY
    )) as SessionStorageSnapshot;
    return typeof callTabId === "number" ? callTabId : null;
}

export async function setCallTabId(tabId?: number | null): Promise<void> {
    await chrome.storage.session.set({ callTabId: typeof tabId === "number" ? tabId : null });
}

export async function getIsTalkingByTabId(): Promise<Record<string, boolean>> {
    const { isTalkingByTabId = {} } = (await chrome.storage.session.get(
        IS_TALKING_KEY
    )) as SessionStorageSnapshot;
    return isTalkingByTabId as Record<string, boolean>;
}

export async function setIsTalkingByTabId(map: Record<string, boolean>): Promise<void> {
    await chrome.storage.session.set({ isTalkingByTabId: map });
}

export async function getAppConnected(): Promise<boolean> {
    const { appConnected } = (await chrome.storage.session.get(
        APP_CONNECTED_KEY
    )) as SessionStorageSnapshot;
    return Boolean(appConnected);
}

export async function setAppConnected(connected: boolean): Promise<void> {
    await chrome.storage.session.set({ appConnected: connected });
}
