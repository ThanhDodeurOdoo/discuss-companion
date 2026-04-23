import { CONTENT_BOOTSTRAP_CHANNEL } from "@extension/src/content/bootstrap";

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
