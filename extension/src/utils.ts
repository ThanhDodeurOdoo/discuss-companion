/**
 * https://developer.chrome.com/docs/extensions/reference/api/scripting
 */

/**
 * Executes code in the current tab's context (the tab where the extension is popped up)
 *
 * @param mainFunc to execute in the window's context, can be async
 */
export async function executeInCurrentTab<T>(mainFunc: () => T): Promise<T | undefined> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) {
        return undefined;
    }
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: "MAIN",
            func: mainFunc
        });
        return results[0]?.result as T;
    } catch (e) {
        console.warn("[Discuss Companion] Execution failed", e);
    }
    return undefined;
}

/**
 * Executes code in the call tab's context (the tab where the call is happening)
 *
 * @param mainFunc to execute in the window's context, can be async
 */
export async function executeInCallTab<T>(mainFunc: () => T): Promise<T | undefined> {
    const { isTalkingByTabId = {} } = (await chrome.storage.session.get("isTalkingByTabId")) as {
        isTalkingByTabId: Record<string, boolean>;
    };
    /**
     * TODO: it is reasonable to assume that tabIds[0] is the only call tab and is relatively well
     * maintained, but it's not 100% safe. A better implementation would be to use to also store
     * the latest subscribed tabId in the storage which is probably the most likely to be relevant.
     * (since if the tab subscrcibed, it joined a call, and one can only be in one call at a time,
     * except for multiple DBs but that's extremely unlikely)
     */
    const tabIds = Object.keys(isTalkingByTabId);
    if (tabIds.length > 0) {
        const tabId = parseInt(tabIds[0], 10);
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                world: "MAIN",
                func: mainFunc
            });
            return results[0]?.result as T;
        } catch (e) {
            console.warn("[Discuss Companion] Execution failed", e);
        }
    }
    return undefined;
}

export function throttle<A extends unknown[], R>(func: (...args: A) => R, wait: number) {
    let inThrottle = false;
    return function (...args: A) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), wait);
        }
    };
}
