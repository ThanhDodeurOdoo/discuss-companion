// From service worker to Page
chrome.runtime.onMessage.addListener(function (request, sender) {
    if (location.origin !== "null" && sender.id === chrome.runtime.id) {
        window.postMessage(request, location.origin);
    }
});

// From Page to service worker
window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) {
        return;
    }

    const { from, type, value } = event.data;
    if (from === "discuss") {
        chrome.runtime.sendMessage({ type, value }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn(
                    "[PTT-Bridge] Error sending to service worker:",
                    chrome.runtime.lastError.message
                );
                return;
            }
            if (type === "ask-version" && response) {
                window.postMessage(
                    { from: "discuss-push-to-talk", type: "answer-version", value: response },
                    location.origin
                );
            }
        });
    }
});
