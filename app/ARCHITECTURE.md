# Discuss Companion App Architecture

Ths covers the desktop app runtime in `app/`:
1. Rust backend process and platform integrations.
2. Owl frontend state orchestration.
3. IPC between frontend/backend.
4. WS coordination with the browser extension.

## Runtime Components
1. Backend runtime (`app/backend/src/runtime.rs`):
   - Composes Tauri plugins, commands, tray/window behavior, WS server lifecycle, and PTT event loop.
2. Backend API layer (`app/backend/src/api/commands.rs`):
   - Tauri commands for binding updates, recording mode, WS port, app visibility, force release, and call commands.
3. Websoket server (`app/backend/src/api/ws_server.rs`):
   - Localhost server for extension connectivity, ping/pong, incoming control frames, and call-state updates.
3. Frontend plugin (`app/frontend/app_plugin.ts`):
   - Signal-based state model and event handlers for permissions, logs, call state, settings, and commands.
4. IPC codec/transport (`app/frontend/ipc.ts`):
   - FlatBuffers encoding for requests and decoding for backend event messages.

## WebSocket Coordination with Extension
1. Server lifecycle:
   - Backend listens on `127.0.0.1:<port>` and can restart on runtime port changes.
2. Outbound app->extension:
   - PTT down/up frames.
   - Call command payloads serialized as `Status` frames.
3. Inbound extension->app:
   - Ping (responded by pong), optional binding/control messages, and call-state snapshots.
4. Connection state:
   - Global connection count tracks onlline/offline status and is propagated to frontend and tray state.

## Platform-Specific PTT Engines
1. macOS:
   - CoreGraphics-based global key event capture.
2. Linux (X11):
   - X11/XRecord path for global input capture.
3. Windows TODO.

## Tray, Dock, and Window Lifecycle
1. Tray icon state:
   - Updated from combined WS connectivity + active speaking state + deaf/mute state.
2. Call controls menu/window:
   - Driven from backend call state updates.
3. Main window close behavior:
   - Close requests hide window instead of exiting.
4. macOS activation policy:
   - Runtime visibility mode controls tray/dock presentation.

## State Persistence
Persisted throug Tauri store:
1. PTT binding (`PTT_BINDING`).
2. WebSocket port (`WS_PORT`).
3. App visibility mode (`APP_VISIBILITY_MODE`).

## Related Docs
- [Repository Architecture Overview](../ARCHITECTURE.md)
- [App Features Guide](./README.md)
- [Extension Architecture](../extension/src/ARCHITECTURE.md)
