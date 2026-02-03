export type OdooPageMessage = {
    from: "discuss";
    type: string;
    value?: unknown;
};

export type ExtensionToPageMessage = {
    from: "discuss-push-to-talk";
    type: string;
    value?: unknown;
};

export function listenToOdooPageMessages(handler: (message: OdooPageMessage) => void): void {
    window.addEventListener("message", (event) => {
        if (event.source !== window || event.origin !== location.origin) {
            return;
        }
        const data = event.data as OdooPageMessage | undefined;
        if (!data || data.from !== "discuss") {
            return;
        }
        handler(data);
    });
}

export function sendToOdooPage(message: ExtensionToPageMessage): void {
    if (location.origin === "null") {
        return;
    }
    window.postMessage(message, location.origin);
}

export function isExtensionToPageMessage(value: unknown): value is ExtensionToPageMessage {
    if (!value || typeof value !== "object") {
        return false;
    }
    const message = value as { from?: unknown; type?: unknown };
    return message.from === "discuss-push-to-talk" && typeof message.type === "string";
}
