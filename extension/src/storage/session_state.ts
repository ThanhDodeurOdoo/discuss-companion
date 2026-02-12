import type { CallState } from "../call_state_types";
import { IS_FIREFOX_BUILD } from "../env";

const CALL_STATE_KEY = "callState";
const CALL_TAB_ID_KEY = "callTabId";
const IS_TALKING_KEY = "isTalkingByTabId";
const APP_CONNECTED_KEY = "appConnected";
export const SESSION_STATE_STORAGE_AREA: "local" | "session" = IS_FIREFOX_BUILD
    ? "local"
    : "session";

type SessionStorageSnapshot = {
    callState?: CallState | null;
    callTabId?: number | null;
    isTalkingByTabId?: Record<string, boolean>;
    appConnected?: boolean;
};

function getSessionStorageArea(): chrome.storage.StorageArea {
    return SESSION_STATE_STORAGE_AREA === "local" ? chrome.storage.local : chrome.storage.session;
}

export async function getCallState(): Promise<CallState | undefined> {
    const storage = getSessionStorageArea();
    const { callState } = (await storage.get(CALL_STATE_KEY)) as SessionStorageSnapshot;
    return callState ?? undefined;
}

export async function setCallState(state?: CallState | null): Promise<void> {
    const storage = getSessionStorageArea();
    await storage.set({ callState: state ?? null });
}

export async function getCallTabId(): Promise<number | null> {
    const storage = getSessionStorageArea();
    const { callTabId } = (await storage.get(CALL_TAB_ID_KEY)) as SessionStorageSnapshot;
    return typeof callTabId === "number" ? callTabId : null;
}

export async function setCallTabId(tabId?: number | null): Promise<void> {
    const storage = getSessionStorageArea();
    await storage.set({ callTabId: typeof tabId === "number" ? tabId : null });
}

export async function getIsTalkingByTabId(): Promise<Record<string, boolean>> {
    const storage = getSessionStorageArea();
    const { isTalkingByTabId = {} } = (await storage.get(IS_TALKING_KEY)) as SessionStorageSnapshot;
    return isTalkingByTabId as Record<string, boolean>;
}

export async function setIsTalkingByTabId(map: Record<string, boolean>): Promise<void> {
    const storage = getSessionStorageArea();
    await storage.set({ isTalkingByTabId: map });
}

export async function getAppConnected(): Promise<boolean> {
    const storage = getSessionStorageArea();
    const { appConnected } = (await storage.get(APP_CONNECTED_KEY)) as SessionStorageSnapshot;
    return Boolean(appConnected);
}

export async function setAppConnected(connected: boolean): Promise<void> {
    const storage = getSessionStorageArea();
    await storage.set({ appConnected: connected });
}

export async function clearSessionState(): Promise<void> {
    const storage = getSessionStorageArea();
    await storage.remove([CALL_STATE_KEY, CALL_TAB_ID_KEY, IS_TALKING_KEY, APP_CONNECTED_KEY]);
}
