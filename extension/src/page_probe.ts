const CONTENT_BOOTSTRAP_CHANNEL = "discuss-companion-bootstrap";

type ProbeWindow = typeof globalThis & {
    odoo?: unknown;
    owl?: {
        __info__?: {
            version?: unknown;
        };
        effect?: unknown;
        proxy?: unknown;
        untrack?: unknown;
    };
};

(() => {
    const scope = globalThis as ProbeWindow;
    const rawOwlVersion = scope.owl?.__info__?.version;
    const owlVersion =
        typeof rawOwlVersion === "string" && rawOwlVersion.trim() ? rawOwlVersion.trim() : null;

    window.postMessage(
        {
            channel: CONTENT_BOOTSTRAP_CHANNEL,
            hasOdoo: Boolean(scope.odoo),
            owlVersion,
            hasOwl3ObservationApi:
                typeof scope.owl?.effect === "function" &&
                typeof scope.owl?.proxy === "function" &&
                typeof scope.owl?.untrack === "function"
        },
        location.origin
    );
})();
