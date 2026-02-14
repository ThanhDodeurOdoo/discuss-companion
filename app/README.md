# Discuss Companion App

## What the App Do
Discuss Companion provide a desktop control surface for Odoo Discuss calls. It captures push-to-talk globaly, syncs with the extension through localhost WebSoket, and exposes fast call actions and status in a compact UI.

## Main Window Features
1. Push-to-talk keybinding button:
   - Click the key display to start recording mode.
   - Press any key combination to store a new binding.
2. Status indicators:
   - Accessibility permission state.
   - Extension WebSoket connection state.
3. Event logs:
   - Shows recent runtime events (PTT, WS, call state, errors).
   - Includes a `Clear` action.
4. Safety action:
   - `force release` in the footer sends an immediate PTT-up safeguard.

## Settings
1. Show icons in PTT button:
   - Toggle between icon symbols and key names.
2. Appearance:
   - Dark mode or clear mode UI theme.
3. App visibility mode (when availabl):
   - Tray + dock only when window is open.
   - Tray + dock always.
   - Dock only.
4. WebSocket port:
   - Configure extension/app WS port.
   - Use `Reload` to restart the server on the new port.

## Call Controls
When an active call is detected, the app shows direct controls:
1. Mute / unmute.
2. Deafen / undeafen.
3. Camera on/off.
4. Screen share on/off.
5. Leave call.
6. `Go to Call` to focus the browser call tab.

## Tray / Dock Behavior
1. The app can run as a tray/dock companion without keeping the main window open.
2. Visibility behavior is controlled by the app visibility setting.
3. Tray and dock menus expose quick controls and lifecycle actions depending on platform/features.

## Typical User Flow
1. Launch the app.
2. Confirm accessibility/input permissions are granted.
3. Configure or record your PTT binding.
4. Enable Discuss Companion in the browser extension.
5. Join an Odoo Discuss call.
6. Use global PTT and optional call controls from the app.

## Troubleshooting
1. Permission shows as missing:
   - Grant Accessibility (and Input Monitoring where required), then retry in-app.
2. Extension disconnected:
   - Check that extension is loaded and `use discuss companion` is enabled.
3. No active call actions available:
   - Ensure an Odoo call is active in the browser and the extension is connected.
4. Commands not reaching extension:
   - Verify the app WS port and extension WS port match, then reload the server.
5. Linux behavior:
   - X11 is supported; Wayland is not currently supported.

## Related Docs
- [App Architecture](./ARCHITECTURE.md)
- [Repository Architecture Overview](../ARCHITECTURE.md)
- [Extension Architecture](../extension/src/ARCHITECTURE.md)
