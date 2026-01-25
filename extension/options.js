// Saves options to chrome.storage
const saveOptions = () => {
    const port = document.getElementById("port").value;
    const status = document.getElementById("status");
    status.textContent = "Saving...";

    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        status.textContent = "Invalid port number.";
        status.style.color = "#cf222e";
        return;
    }

    console.log("[Discuss Companion Options] Saving port:", portNum);

    chrome.storage.local.set({ wsPort: portNum }, () => {
        // Update status to let user know options were saved.
        status.textContent = "Options saved. Extension reloading connection...";
        status.style.color = "#2da44e";
        console.log("[Discuss Companion Options] Port saved.");

        setTimeout(() => {
            status.textContent = "";
        }, 2000);
    });
};

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
const restoreOptions = () => {
    console.log("[Discuss Companion Options] Restoring options...");
    chrome.storage.local.get({ wsPort: 49152 }, (items) => {
        document.getElementById("port").value = items.wsPort;
        console.log("[Discuss Companion Options] Options restored. Port:", items.wsPort);
    });
};

document.addEventListener("DOMContentLoaded", restoreOptions);
document.getElementById("save").addEventListener("click", saveOptions);
