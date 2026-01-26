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
