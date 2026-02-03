# Discuss Companion Extension Architecture

This document explains how call actions, the service worker, the content script, the page bridge, and the app (WS) interact.

## Components

### Call actions
- `extension/src/call_action_definitions.ts` is the single source of truth for action IDs and flags.
- `extension/src/call_actions.ts` derives the runtime/type system from the definitions:
  - `CallActionType` map (stable string IDs).
  - `CallAction` union for runtime validation.
  - `CALL_ACTION_APP_COMMANDS` map used by the WS/app command parser.
  - `requiresValue` controls whether actions must carry a boolean payload.
    - `requiresValue: false` actions are “toggles” (e.g. toggle mic), invoked as `{ type }`.
    - `requiresValue: true` actions are “setters” (e.g. set mute), invoked as `{ type, value: boolean }`.
    - The WS/app parser uses this flag to validate input and reject missing/invalid values.

### Content script (extension/content.ts)
- Owns the WebSocket lifecycle (connect/ping/reconnect).
- Injects the page bridge (`page_bridge.js`) and uses it for call actions and call-state polling.
- The bridge is bundled as a module and may pull shared chunks; `web_accessible_resources` exposes
  `page_bridge.js`, `content_bundle.js`, and `assets/*.js` so the page can load them.
- Translates app WS commands into call actions.
- Keeps an in-memory `callState` cache and forwards updates to the service worker (content scripts
  cannot access `chrome.storage.session`).
- Connects the WS only when:
  - The tab is the elected owner.
  - The Odoo page has subscribed (call has started).
  - Companion is enabled in local settings.

### Page bridge (extension/src/page_bridge.ts)
- Runs in the page context.
- Executes call actions by calling Odoo’s RTC service.
- Polls call state and emits `call-state-update` events.
- Uses a request/response protocol over `window.postMessage` (`bridge_protocol.ts`).

### Service worker (background)
- `extension/src/service_worker.ts` wires listeners and delegates to the message handler.
- `extension/src/service_worker_messages.ts` handles:
  - Message routing for popup/content scripts/external callers.
  - Tab/session bookkeeping and toolbar icon updates.
  - Ownership and forwarding of popup actions to the content script.
  - Persisting `callState` updates coming from the content script.

### Popup and command API
- `extension/src/command_api.ts` routes popup actions to the service worker.
- `extension/src/popup/popup_plugin.ts` uses `CallActionType` and `requestCallAction`.
- `executeInCurrentTab` skips restricted pages (e.g. `chrome://`) to avoid execution errors.

### Storage and state
- `chrome.storage.local`: user settings (`wsPort`, `isCompanionEnabled`, `isLoggingEnabled`).
- `chrome.storage.session`: tab-scoped runtime state (`callState`, `callTabId`, `isTalkingByTabId`,
  `appConnected`).
- Content scripts never write to session storage directly; they report updates to the service worker,
  which owns session storage writes.

## WebSocket lifecycle

- The WS client is encapsulated in `extension/src/ws/ws_client.ts`.
- Ping/pong keeps the connection alive:
  - `ws_client.ts` sends ping payloads every 30s (default) and on open.
  - `ws_codec.ts` builds/decodes ping/pong messages.
- Reconnects are scheduled with a fixed delay (default 6s) when the socket closes.
- The content script connects only when `isOwner && isSubscribed && isCompanionEnabled`.

## Message flow

### Odoo Page → Service Worker → Content Script
1. The Odoo page sends `subscribe` / `unsubscribe` / `is-talking` (via `chrome.runtime.sendMessage` or `window.postMessage`).
2. The service worker updates session storage and elects an owner tab.
3. The service worker notifies the content script (`content-subscribe`, `content-unsubscribe`, `content-owner-update`).

### App (WS) → Content Script → Page Bridge
1. The app sends a WS `Status` message containing a command string.
2. The content script parses the string (`parseAppCommand`) and resolves it to a `CallAction`.
3. The content script calls the page bridge to execute the action in the page context.

### Popup → Service Worker → Content Script → Page Bridge
1. Popup calls `requestCallAction`.
2. The service worker forwards the request to the owner content script.
3. The content script executes the action via the page bridge and returns the result.

### Content Script → Service Worker (state updates)
1. The page bridge emits `call-state-update` events while polling.
2. The content script caches the latest `callState` in memory.
3. The content script sends `content-call-state-update` to the service worker.
4. The service worker writes `callState` into `chrome.storage.session` for the popup.

### Ownership model
- The service worker keeps `isTalkingByTabId` and `callTabId` in session storage.
- The owner is the active call tab (first tab in the map if no active owner is known).
- Only the owner tab maintains a WS connection.

Supported WS command formats:
- JSON: `{"command":"toggle-microphone","value":true}`
- Key/value: `toggle-microphone:true`
- Bare command: `toggle-microphone`

## Internal message types

### Page → Extension
- `ask-is-enabled`
- `subscribe`
- `unsubscribe`
- `is-talking`
- `ask-version`

### Service Worker → Content
- `content-subscribe`
- `content-unsubscribe`
- `content-owner-update`
- `content-call-action`
- `content-refresh-call-state`

### Content → Service Worker
- `content-connection-state`
- `content-call-state-update`

## Security and permissions

- `page_bridge.js` is injected as a module script into the page context.
- The bridge may import shared chunks, so `web_accessible_resources` must include:
  - `page_bridge.js`
  - `content_bundle.js`
  - `assets/*.js`
- The content script runs on all HTTP(S) pages but only activates the WS when the Odoo page subscribes.
- The popup avoids script injection into restricted URLs (`chrome://`, `edge://`, `about:`).

## Adding a new call action

1. Define it in one place: `extension/src/call_action_definitions.ts`.
   - Pick a stable `id`.
   - Set `requiresValue` and `requiresUserGesture` as needed.
   - Optional: add `appCommands` if the WS/app should accept extra aliases.

2. Implement it in the page bridge:
   - Add the action logic to `extension/src/page_bridge.ts`.

3. Use it from UI or other callers:
   - Popup: import `CallActionType` and call `requestCallAction({ type: CallActionType.YourAction })`.

4. WS/app integration:
   - If the app sends the action `id` (or any `appCommands` alias), the content script will recognize it.
   - If `requiresValue: true`, provide a boolean value (`true`/`false`, `1`/`0`, `on`/`off`).
     - Example: `{"command":"set-mute","value":true}` or `set-mute:on`.
     - This makes idempotent commands possible (e.g. “ensure muted”) instead of relying on toggles.

That’s it—no other files need changes for the action to be recognized by the content script and WS/app command API.
