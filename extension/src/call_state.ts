export type CallState = {
    isMute: boolean;
    isDeaf: boolean;
    isCameraOn: boolean;
    isScreenOn: boolean;
};

const CALL_STATE_KEY = "callState";
const CALL_TAB_ID_KEY = "callTabId";

type SessionStorageSnapshot = {
    callState?: CallState | null;
    callTabId?: number | null;
    isTalkingByTabId?: Record<string, boolean>;
};

export async function getStoredCallState(): Promise<CallState | undefined> {
    const { callState } = (await chrome.storage.session.get(
        CALL_STATE_KEY
    )) as SessionStorageSnapshot;
    return callState ?? undefined;
}

export async function setStoredCallState(state?: CallState | null): Promise<void> {
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
    const { isTalkingByTabId = {} } = (await chrome.storage.session.get(
        "isTalkingByTabId"
    )) as SessionStorageSnapshot;
    const tabId = pickFirstTabId(isTalkingByTabId);
    if (tabId !== null) {
        await setCallTabId(tabId);
    }
    return tabId;
}
