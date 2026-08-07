export const CONTENT_BOOTSTRAP_CHANNEL = "discuss-companion-bootstrap";

type ContentBootstrapDeps = {
    loadContentRuntime: () => Promise<void>;
    probeRuntimeSupport: () => Promise<boolean>;
};

export type OdooRuntimeProbe = {
    hasOdoo: boolean;
    owlVersion: string | null;
    hasOwl3ObservationApi: boolean;
};

type OdooProbeMessage = OdooRuntimeProbe & {
    channel: typeof CONTENT_BOOTSTRAP_CHANNEL;
};

const OWL_2_VERSION_PATTERN = /^2\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const OWL_3_VERSION_PATTERN = /^3\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function isSupportedOdooRuntime(runtime: OdooRuntimeProbe): boolean {
    if (!runtime.hasOdoo || !runtime.owlVersion) {
        return false;
    }
    if (OWL_2_VERSION_PATTERN.test(runtime.owlVersion)) {
        return true;
    }
    return OWL_3_VERSION_PATTERN.test(runtime.owlVersion) && runtime.hasOwl3ObservationApi;
}

function isOdooProbeMessage(value: unknown): value is OdooProbeMessage {
    if (!value || typeof value !== "object") {
        return false;
    }
    const message = value as {
        channel?: unknown;
        hasOdoo?: unknown;
        owlVersion?: unknown;
        hasOwl3ObservationApi?: unknown;
    };
    return (
        message.channel === CONTENT_BOOTSTRAP_CHANNEL &&
        typeof message.hasOdoo === "boolean" &&
        (typeof message.owlVersion === "string" || message.owlVersion === null) &&
        typeof message.hasOwl3ObservationApi === "boolean"
    );
}

async function loadContentRuntime(): Promise<void> {
    await import(chrome.runtime.getURL("content_bundle.js"));
}

async function probeRuntimeSupport(): Promise<boolean> {
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
            resolve(isSupportedOdooRuntime(event.data));
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
    deps: ContentBootstrapDeps = { loadContentRuntime, probeRuntimeSupport }
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
        probePromise = deps.probeRuntimeSupport().finally(() => {
            probePromise = null;
        });
        void probePromise.then((isSupported) => {
            if (!isSupported || runtimeLoaded) {
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
