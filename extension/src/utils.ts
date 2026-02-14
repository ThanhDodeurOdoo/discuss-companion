/**
 * https://developer.chrome.com/docs/extensions/reference/api/scripting
 */

import { resolveCallTabId } from "@extension/src/call_state";

const RESTRICTED_URL_PREFIXES = [
    "chrome://",
    "chrome-extension://",
    "edge://",
    "brave://",
    "opera://",
    "vivaldi://",
    "about:",
    "moz-extension://"
];

function isRestrictedUrl(url?: string | null): boolean {
    if (!url) {
        return true;
    }
    return RESTRICTED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * Executes code in the current tab's context (the tab where the extension is popped up)
 *
 * @param mainFunc to execute in the window's context, can be async
 */
export async function executeInCurrentTab<T, A extends unknown[] = []>(
    mainFunc: (...args: A) => T,
    args?: A
): Promise<T | undefined> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || isRestrictedUrl(tab.url)) {
        return undefined;
    }
    try {
        const results = await chrome.scripting.executeScript(
            args
                ? {
                      target: { tabId: tab.id },
                      world: "MAIN",
                      func: mainFunc,
                      args
                  }
                : {
                      target: { tabId: tab.id },
                      world: "MAIN",
                      func: mainFunc
                  }
        );
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
export async function executeInCallTab<T, A extends unknown[] = []>(
    mainFunc: (...args: A) => T,
    args?: A
): Promise<T | undefined> {
    const tabId = await resolveCallTabId();
    if (tabId === null) {
        return undefined;
    }
    try {
        const results = await chrome.scripting.executeScript(
            args
                ? {
                      target: { tabId },
                      world: "MAIN",
                      func: mainFunc,
                      args
                  }
                : {
                      target: { tabId },
                      world: "MAIN",
                      func: mainFunc
                  }
        );
        return results[0]?.result as T;
    } catch (e) {
        console.warn("[Discuss Companion] Execution failed", e);
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
