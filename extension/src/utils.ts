/**
 * https://developer.chrome.com/docs/extensions/reference/api/scripting
 *
 * @param mainFunc to execute in the window's context, can be async
 */
export async function executeInMainWorld<T>(mainFunc: () => T): Promise<T | undefined> {
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
        return undefined;
    }
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
