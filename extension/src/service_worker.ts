import {
    createMessageHandlers,
    type MessageHandlers
} from "@extension/src/service_worker_messages";
import { IS_FIREFOX_BUILD } from "@extension/src/env";
import { clearSessionState } from "@extension/src/storage/session_state";

/**
 * Service-worker entrypoint
 *
 * The worker has two core responsibilities:
 * 1) expose a stable command/message surface to popup/content/page contexts,
 * 2) own process-wide resources that must survive across tab-level runtimes
 *    (session registry, icon state, logging policy, command routing).
 *
 * This file intentionally stays as a composition root: it wires browser event
 * sources to `messageHandlers` and does not embed business logic. That keeps
 * event policy centralized while allowing message semantics to evolve in
 * dedicated modules.
 */
const mutedLog = (..._args: unknown[]) => {};
let logTarget: (...args: unknown[]) => void = mutedLog;
const log = (...args: unknown[]) => logTarget(...args);

const messageHandlers: MessageHandlers = createMessageHandlers({
    log
});

if (IS_FIREFOX_BUILD) {
    chrome.runtime.onStartup.addListener(() => {
        void clearSessionState();
    });
    chrome.runtime.onInstalled.addListener(() => {
        void clearSessionState();
    });
}

/**
 * Bootstrap logger policy from persisted settings.
 *
 * `log()` is used by handlers as a stable call-site, while `logTarget` is the
 * mutable implementation. This indirection lets us reconfigure logging at
 * runtime without recreating handlers or re-binding browser listeners.
 *
 * TODO: my intuition would be that when the JS engine sees that the function
 * is empty, that it inlines it into noop (and does not even evaluate the strings
 * which is also costly). Need to investigate if its true, if not maybe log takes
 * a callback that is called (and therefore evaluates the string) only when actually
 * logging.
 *
 * Default is muted to keep production noise low when settings are unavailable.
 */
chrome.storage.local.get({ isLoggingEnabled: false }, (items) => {
    logTarget = items.isLoggingEnabled ? console.log : mutedLog;
});

/**
 * Primary message ingress for all extension peers (popup, content, bridge).
 *
 * Contract details:
 * - every request is delegated to `messageHandlers` for domain routing;
 * - we always return `true` to keep `sendResponse` valid for async flows;
 * - failures are handled by the handler layer so this listener remains minimal.
 *
 * Keeping one ingress point simplifies protocol evolution and observability.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log("[BG] onMessage", request, sender);
    void messageHandlers.handleMessage(request, sender, sendResponse);
    return true;
});

/**
 * Tab teardown hook.
 *
 * The worker tracks per-tab session metadata for routing requests/responses.
 * When a tab closes we must explicitly release that state to avoid:
 * - leaking tab-scoped resources in long-lived worker processes,
 * - routing messages to non-existent tabs after reconnect/reload cycles.
 */
chrome.tabs.onRemoved.addListener(async (tabId) => {
    await messageHandlers.handleTabRemoved(tabId);
});

/**
 * Browser action click handler.
 *
 * The action button is the lowest-friction user entrypoint. Treating the click
 * as an explicit intent signal allows the handler layer to perform UX-focused
 * side effects (focus/open companion UI, refresh icon, bootstrap connection).
 */
chrome.action.onClicked.addListener(() => {
    messageHandlers.handleActionClicked();
});

if (!IS_FIREFOX_BUILD) {
    /**
     * Keyboard command ingress (Chromium only).
     *
     * Firefox command behavior diverges from Chromium in this project setup, so
     * command registration is feature-gated. The handler still receives the same
     * normalized command id contract regardless of source platform.
     *
     * (the reason why there is no command feature for fireox is that it has much lower
     * value because it does not support global keypresses)
     */
    chrome.commands.onCommand.addListener((command) => {
        messageHandlers.handleCommand(command);
    });
}

void messageHandlers.updateAppIcon();

/**
 * Live settings reconciliation.
 *
 * The service worker can stay alive across many interactions. Listening to
 * storage updates keeps runtime behavior synchronized with persisted settings
 * without waiting for a worker restart. Logging toggles therefore apply
 * immediately to all subsequent message and lifecycle events.
 */
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
        return;
    }
    if (changes.isLoggingEnabled) {
        logTarget = changes.isLoggingEnabled.newValue ? console.log : mutedLog;
    }
});
