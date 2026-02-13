export function createOwnershipController(deps: {
    setStoredCallState: (state?: import("../call_state_types").CallState | null) => Promise<void>;
    getCallTabId: () => Promise<number | null>;
    setCallTabId: (tabId?: number | null) => Promise<void>;
    getIsTalkingByTabId: () => Promise<Record<string, boolean>>;
    sendToContentTab: (
        tabId: number,
        message: import("../messaging/sw_channel").SwToContentMessage
    ) => void;
}) {
    const { setStoredCallState, getCallTabId, setCallTabId, sendToContentTab } = deps;

    function pickFirstTabId(isTalkingByTabId: Record<string, boolean>): number | null {
        const tabIds = Object.keys(isTalkingByTabId);
        if (tabIds.length === 0) {
            return null;
        }
        const tabId = Number(tabIds[0]);
        return Number.isNaN(tabId) ? null : tabId;
    }

    async function setActiveCallTab(tabId: number | null): Promise<void> {
        const currentTabId = await getCallTabId();
        if (currentTabId === tabId) {
            return;
        }
        await setCallTabId(tabId);
        await setStoredCallState(null);
    }

    async function isOwnerTab(tabId: number): Promise<boolean> {
        const ownerTabId = await getCallTabId();
        if (ownerTabId === null) {
            return true;
        }
        return ownerTabId === tabId;
    }

    async function syncCallTabIdFromMap(
        isTalkingByTabId: Record<string, boolean>
    ): Promise<number | null> {
        const currentTabId = await getCallTabId();
        if (currentTabId !== null && isTalkingByTabId[currentTabId] !== undefined) {
            return currentTabId;
        }
        const nextTabId = pickFirstTabId(isTalkingByTabId);
        await setActiveCallTab(nextTabId);
        return nextTabId;
    }

    async function notifyOwnerChange(
        previousOwner: number | null,
        nextOwner: number | null,
        isTalkingByTabId: Record<string, boolean>
    ): Promise<void> {
        if (nextOwner !== null && nextOwner !== previousOwner) {
            sendToContentTab(nextOwner, {
                type: "content-owner-update",
                value: { isOwner: true }
            });
        }
        if (
            previousOwner !== null &&
            previousOwner !== nextOwner &&
            isTalkingByTabId[previousOwner] !== undefined
        ) {
            sendToContentTab(previousOwner, {
                type: "content-owner-update",
                value: { isOwner: false }
            });
        }
    }

    return {
        setActiveCallTab,
        isOwnerTab,
        syncCallTabIdFromMap,
        notifyOwnerChange
    };
}
