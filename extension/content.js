// From Background to Page
chrome.runtime.onMessage.addListener(function (request, sender) {
    console.log("[Content] onMessage from BG:", request);
    if (location.origin !== "null" && sender.id === chrome.runtime.id) {
        window.postMessage(request, location.origin);
    }
});

// From Page to Background
window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) {
        return;
    }

    console.log("[Content] message from Page:", event.data);
    const { from, type, value } = event.data;
    if (from === "discuss") {
        chrome.runtime.sendMessage({ type, value }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn(
                    "[PTT-Bridge] Error sending to background:",
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
