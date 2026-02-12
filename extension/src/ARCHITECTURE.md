# Discuss Companion Extension Architecture

This document describes the current extension runtime after the hard cutover to the reactive Odoo lifecycle model.

## Core decisions

- `rtc.localSession` is the only source of truth for call lifecycle.
- Lifecycle detection is reactive (`store.onChange`), not polling.
- PTT runs directly through Odoo RTC APIs (`onPushToTalk`, `setPttReleaseTimeout`).
- No legacy compatibility path remains for the old Odoo PTT extension service.
- The service worker owns cross-tab state and owner election.

## Runtime components

### Call actions

- `extension/src/call_action_definitions.ts` is the source of truth for action IDs and flags.
- `extension/src/call_actions.ts` derives:
  - `CallActionType` stable IDs.
  - `CallAction` union validation.
  - `CALL_ACTION_APP_COMMANDS` aliases for WS commands.
  - `requiresValue` contract for toggles vs setters.

### Page bridge (`extension/src/page_bridge.ts`)

- Runs in page context and calls Odoo services directly.
- Uses `mail.store.onChange` to watch:
  - `rtc.localSession` for lifecycle.
  - Session fields for state:
    - `isTalking`
    - `is_muted`, `is_deaf`, `is_camera_on`, `is_screen_sharing_on`
- Emits:
  - `call-lifecycle-update`
  - `call-state-update`
- Handles bridge requests:
  - `call-action`, `read-call-state`, `get-call-info`
  - `probe-rtc`, `start-store-watch`, `stop-store-watch`
  - `ptt-command`

### Content script (`extension/src/content.ts`)

- Injects and talks to the page bridge.
- Starts the bridge watcher via `start-store-watch` (with retries on initial load/focus/visibility).
- Translates lifecycle events into SW coordination:
  - call start => `subscribe`
  - call end => `is-talking: false`, then `unsubscribe`
  - in-call talking changes => `is-talking`
- Owns WS connection lifecycle and command decoding.
- Routes both WS PTT frames and SW shortcut messages to bridge `ptt-command`.
- Keeps in-memory `cachedCallState` and forwards state snapshots to SW.

### Service worker (`extension/src/service_worker.ts`, `extension/src/service_worker_messages.ts`)

- Handles message routing and tab ownership.
- Maintains session state:
  - `isTalkingByTabId`
  - `callTabId`
  - persisted call state for popup consumption
- Forwards popup call actions to the owner tab.
- Forwards keyboard commands as `content-ptt-command`.
- Updates toolbar icon from app connectivity and speaking state.

### Popup and command API

- `extension/src/command_api.ts` routes popup requests to SW.
- `extension/src/popup/popup_plugin.ts` uses `CallActionType` and `requestCallAction`.
- Restricted browser pages are excluded from script execution.

## Reactive lifecycle model (`rtc.localSession`)

### Bridge startup

1. Content script requests `start-store-watch`.
2. Bridge attempts immediate watcher registration on `store.onChange(rtc, "localSession", ...)`.
3. If Odoo runtime is not ready yet, bridge enables a bootstrap watcher (`MutationObserver` + `readystatechange`) until attach succeeds.

### Lifecycle transitions

- `false -> true` (`localSession` appears):
  - old session watchers are removed first.
  - new session watchers are bound on that exact session record.
  - lifecycle and state are emitted immediately.
- `true -> false` (`localSession` cleared):
  - session watchers are removed immediately.
  - lifecycle end (`hasHostedCall: false`) is emitted.
  - cleared state (`hasState: false`) is emitted.
- `A -> B` (session switch):
  - A watchers are removed before B watchers are attached.
  - only B events are accepted.

### Stale callback protection

The bridge uses both:

- a monotonic session token, and
- a stable session key (`localId`, fallback `id`)

to ignore events coming from stale callbacks after a switch/end.

## Message contracts

### Bridge protocol (`extension/src/messaging/bridge_protocol.ts`)

- Requests:
  - `call-action`
  - `read-call-state`
  - `get-call-info`
  - `probe-rtc`
  - `start-store-watch`
  - `stop-store-watch`
  - `ptt-command`
- Events:
  - `call-lifecycle-update`: `{ hasRtcService, hasHostedCall, isTalking }`
  - `call-state-update`: `{ hasState, state? }`

### SW <-> content channel (`extension/src/messaging/sw_channel.ts`)

- SW -> content:
  - `content-subscribe`
  - `content-unsubscribe`
  - `content-owner-update`
  - `content-call-action`
  - `content-refresh-call-state`
  - `content-ptt-command` (`ptt-down` | `ptt-up` | `toggle-voice`)
- content -> SW (internal coordination):
  - `subscribe`
  - `unsubscribe`
  - `is-talking`
  - `content-call-state-update`
  - `content-connection-state`
  - `focus-call-tab`

## Ownership and WS gating

- SW elects one owner tab from subscribed call tabs (`isTalkingByTabId` map + `callTabId`).
- Content script connects WS only when:
  - `isOwner === true`
  - `isSubscribed === true`
  - companion is enabled in local settings
- This prevents non-call tabs and non-owner tabs from maintaining WS connections.

## PTT behavior

### App-driven PTT

1. App sends WS frame (`ptt-down` / `ptt-up`).
2. Content decodes and sends bridge `ptt-command`.
3. Bridge executes on active `rtc.localSession`:
  - `ptt-down` => `rtc.onPushToTalk()`
  - `ptt-up` => `rtc.setPttReleaseTimeout()` when not voice-latched

### Shortcut-driven PTT

1. Browser shortcut reaches SW (`ptt-pressed`, `ptt-released`, `toggle-voice`).
2. SW forwards to subscribed tabs as `content-ptt-command`.
3. Content forwards to bridge `ptt-command`.
4. Bridge applies same RTC API path as app-driven PTT.

### Voice latch (`toggle-voice`)

- first toggle: calls `onPushToTalk`, sets `voiceActivated = true`
- second toggle: calls `setPttReleaseTimeout(0)`, sets `voiceActivated = false`

## Call state propagation

1. Bridge emits `call-state-update` from reactive session field watchers.
2. Content updates in-memory cache and forwards `content-call-state-update` to SW when needed.
3. SW persists state in `chrome.storage.session` for popup and shared runtime access.
4. When owner/subscribed state changes, content sends refreshed snapshots to the app over WS.

## Storage model

- `chrome.storage.local`:
  - `wsPort`
  - `isCompanionEnabled`
  - `isLoggingEnabled`
- `chrome.storage.session`:
  - `callState`
  - `callTabId`
  - `isTalkingByTabId`
  - `appConnected`

Content scripts never directly write `chrome.storage.session`; SW owns these writes.

## WebSocket behavior

- WS client: `extension/src/ws/ws_client.ts`
- Codec/parsing: `extension/src/ws/ws_codec.ts`
- Ping/pong keepalive with reconnect delay.
- Supported app command payload formats:
  - JSON: `{"command":"toggle-microphone","value":true}`
  - key/value: `toggle-microphone:true`
  - bare command: `toggle-microphone`

### Firefox FlatBuffers fallback

Firefox can throw cross-compartment errors when parsing some FlatBuffers `Status` payloads in content scripts. The extension keeps a Firefox-only `DataView` fallback parser for `Message.bodyType` and `Status.state` while preserving the same wire format.

## Security and permissions

- `page_bridge.js` is injected as a module script in page context.
- `web_accessible_resources` must expose:
  - `page_bridge.js`
  - `content_bundle.js`
  - `assets/*.js`
- Extension runs on HTTP(S) pages, but watcher activation requires Odoo runtime availability.

## Removed legacy flow (intentional)

- No old page-message compatibility bridge remains.
- No `discuss-push-to-talk` forwarding path remains.
- No `ask-is-enabled` or `ask-version` SW cases remain.
- No `chrome.runtime.onMessageExternal` listener remains.
- No `externally_connectable` manifest entry remains.
- No compatibility tests/files for the removed flow remain.

## Adding a new call action

1. Add definition in `extension/src/call_action_definitions.ts`.
2. Implement runtime behavior in `extension/src/page_bridge.ts` (`runAction`).
3. Use from popup/other callers through `CallActionType` and SW call-action routing.
4. If needed for app commands, add aliases to `appCommands`.
