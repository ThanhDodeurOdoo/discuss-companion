(async () => {
    try {
        await import(chrome.runtime.getURL("content_bundle.js"));
    } catch (error) {
        console.error("[Discuss Companion] Failed to load content script", error);
    }
})();
