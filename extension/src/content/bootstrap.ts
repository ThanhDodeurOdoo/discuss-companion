export const CONTENT_BOOTSTRAP_CHANNEL = "discuss-companion-bootstrap";

type ContentBootstrapDeps = {
    loadContentRuntime: () => Promise<void>;
    probePageForOdoo: () => Promise<boolean>;
};

type OdooProbeMessage = {
    channel: typeof CONTENT_BOOTSTRAP_CHANNEL;
    hasOdoo: boolean;
};

function isOdooProbeMessage(value: unknown): value is OdooProbeMessage {
    if (!value || typeof value !== "object") {
        return false;
    }
    const message = value as { channel?: unknown; hasOdoo?: unknown };
    return message.channel === CONTENT_BOOTSTRAP_CHANNEL && typeof message.hasOdoo === "boolean";
}

async function loadContentRuntime(): Promise<void> {
    await import(chrome.runtime.getURL("content_bundle.js"));
}

async function probePageForOdoo(): Promise<boolean> {
    const target = document.head ?? document.documentElement;
    if (!target) {
        return false;
    }

    return new Promise((resolve) => {
        const script = document.createElement("script");
        const timeoutId = window.setTimeout(() => {
            cleanup();
            resolve(false);
        }, 1000);

        const cleanup = () => {
            window.clearTimeout(timeoutId);
            window.removeEventListener("message", handleMessage);
            script.remove();
        };

        const handleMessage = (event: MessageEvent) => {
            if (event.source !== window || event.origin !== location.origin) {
                return;
            }
            if (!isOdooProbeMessage(event.data)) {
                return;
            }
            cleanup();
            resolve(event.data.hasOdoo);
        };

        window.addEventListener("message", handleMessage);
        script.src = chrome.runtime.getURL("page_probe.js");
        script.async = false;
        script.onerror = () => {
            cleanup();
            resolve(false);
        };
        target.appendChild(script);
    });
}

export function startContentBootstrap(
    deps: ContentBootstrapDeps = { loadContentRuntime, probePageForOdoo }
): void {
    const MAX_RETRIES = 5;
    let runtimeLoaded = false;
    let probePromise: Promise<boolean> | null = null;
    let intervalId: number | null = null;
    let retryCount = 0;

    const cleanup = () => {
        if (intervalId !== null) {
            window.clearInterval(intervalId);
            intervalId = null;
        }
        document.removeEventListener("DOMContentLoaded", onReady);
        window.removeEventListener("load", onReady);
    };

    const onReady = () => {
        if (runtimeLoaded) {
            cleanup();
            return;
        }
        if (retryCount >= MAX_RETRIES) {
            cleanup();
            return;
        }
        if (probePromise) {
            return;
        }
        retryCount++;
        probePromise = deps.probePageForOdoo().finally(() => {
            probePromise = null;
        });
        void probePromise.then((hasOdoo) => {
            if (!hasOdoo || runtimeLoaded) {
                return;
            }
            runtimeLoaded = true;
            cleanup();
            void deps.loadContentRuntime().catch((error) => {
                runtimeLoaded = false;
                console.error("[Discuss Companion] Failed to load content runtime", error);
            });
        });
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", onReady, { once: true });
    }
    if (document.readyState !== "complete") {
        window.addEventListener("load", onReady, { once: true });
    }

    intervalId = window.setInterval(onReady, 2000);
    onReady();
}
