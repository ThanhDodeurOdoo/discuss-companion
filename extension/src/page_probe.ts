const CONTENT_BOOTSTRAP_CHANNEL = "discuss-companion-bootstrap";

type ProbeWindow = typeof globalThis & {
    odoo?: unknown;
};

window.postMessage(
    {
        channel: CONTENT_BOOTSTRAP_CHANNEL,
        hasOdoo: Boolean((globalThis as ProbeWindow).odoo)
    },
    location.origin
);
