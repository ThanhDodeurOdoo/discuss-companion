# Discuss Companion Extension Architecture

This document explains how call actions, the service worker, the popup, and the app (WS) interact.

## Components

### Call actions
- `extension/src/call_action_registry.ts` is the single source of truth for action definitions.
- `extension/src/call_actions.ts` derives the runtime/type system from the registry:
  - `CallActionType` map (stable string IDs).
  - `CallAction` union for runtime validation.
  - `CALL_ACTION_APP_COMMANDS` map used by the WS/app command parser.
  - `executeCallAction` runs actions inside the call tab.
  - `requiresValue` controls whether actions must carry a boolean payload.
    - `requiresValue: false` actions are “toggles” (e.g. toggle mic), invoked as `{ type }`.
    - `requiresValue: true` actions are “setters” (e.g. set mute), invoked as `{ type, value: boolean }`.
    - The WS/app parser uses this flag to validate input and reject missing/invalid values.

### Service worker (background)
- `extension/src/service_worker.ts` wires the two subsystems below and registers listeners.
- `extension/src/service_worker_connection.ts` handles:
  - Storage bootstrapping (port, logging, enablement).
  - WebSocket lifecycle, reconnect alarms, and ping.
  - Flatbuffer WS message decoding and dispatch to handlers.
- `extension/src/service_worker_messages.ts` handles:
  - Message routing for popup/content scripts/external callers.
  - Command parsing from WS/app status strings.
  - Tab/session bookkeeping and toolbar icon updates.

### Popup and command API
- `extension/src/command_api.ts` routes popup actions to the service worker.
- `extension/src/popup/popup_plugin.ts` uses `CallActionType` and `requestCallAction`.

## Message flow

### Popup → Service Worker → Call tab
1. Popup calls `requestCallAction`.
2. The service worker validates and dispatches via `executeCallAction`.
3. The action’s `run` executes inside the call tab (via `executeInCallTab`).
4. State is refreshed and returned to the popup.

### App (WS) → Service Worker → Call tab
1. The app sends a WS `Status` message containing a command string.
2. The service worker parses the string (`parseAppCommand`) and resolves it to a `CallAction`.
3. The action executes in the call tab.

Supported WS command formats:
- JSON: `{"command":"toggle-microphone","value":true}`
- Key/value: `toggle-microphone:true`
- Bare command: `toggle-microphone`

## Adding a new call action

1. Define it in one place: `extension/src/call_action_registry.ts`.
   - Pick a stable `id`.
   - Set `requiresValue` and `requiresUserGesture` as needed.
   - Implement `run` (executes in the call tab).
   - Optional: add `appCommands` if the WS/app should accept extra aliases.

2. Use it from UI or other callers:
   - Popup: import `CallActionType` and call `requestCallAction({ type: CallActionType.YourAction })`.
   - Background callers: create a `CallAction` and pass to `executeCallAction`.

3. WS/app integration:
   - If the app sends the action `id` (or any `appCommands` alias), the service worker will recognize it.
   - If `requiresValue: true`, provide a boolean value (`true`/`false`, `1`/`0`, `on`/`off`).
     - Example: `{"command":"set-mute","value":true}` or `set-mute:on`.
     - This makes idempotent commands possible (e.g. “ensure muted”) instead of relying on toggles.

That’s it—no other files need changes for the action to be recognized by the service worker and WS/app command API.
