console.log("[PTT-Bridge] Content script loaded for", location.origin);

// From Background to Page
chrome.runtime.onMessage.addListener(function (request, sender) {
    if (location.origin !== "null" && sender.id === chrome.runtime.id) {
        console.log("[PTT-Bridge] Redirecting message to page:", request.type);
        window.postMessage(request, location.origin);
    }
});

// From Page to Background
window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) {
        return;
    }
    const { from, type, value } = event.data;
    if (from === "discuss") {
        console.log("[PTT-Bridge] Intercepted message from page:", type, value);
        chrome.runtime.sendMessage({ type, value }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn(
                    "[PTT-Bridge] Error sending to background:",
                    chrome.runtime.lastError.message
                );
                return;
            }
            if (type === "ask-version" && response) {
                console.log("[PTT-Bridge] Relaying version response to page:", response);
                window.postMessage(
                    { from: "discuss-push-to-talk", type: "answer-version", value: response },
                    location.origin
                );
            }
        });
    }
});
