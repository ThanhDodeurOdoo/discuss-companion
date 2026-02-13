export function createTabFocusController(deps: {
    getCallTabId: () => Promise<number | null>;
    log: (...args: unknown[]) => void;
}) {
    const { getCallTabId, log } = deps;

    async function focusCallTab(): Promise<boolean> {
        const tabId = await getCallTabId();
        if (tabId === null) {
            return false;
        }
        try {
            const tab = await chrome.tabs.get(tabId);
            if (!tab) {
                return false;
            }
            await chrome.tabs.update(tabId, { active: true });
            await chrome.windows.update(tab.windowId, { focused: true });
            return true;
        } catch (error) {
            log("Failed to focus tab", error);
            return false;
        }
    }

    return {
        focusCallTab
    };
}
