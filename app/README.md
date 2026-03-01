# Discuss Companion App

## What the App Do
Discuss Companion provide a desktop control surface for Odoo Discuss calls. It captures push-to-talk globaly, anc syncs with the extension.

## Main Window Features
1. Push-to-talk keybinding button:
   - Click the key display to start recording mode.
   - Press any key combination to store a new binding.
2. Call controls (mute, defen, camera, screen share, leave call).
3. Go to call button (moves to and focuses the tab that hosts the call)
4. Systray controls and button (depending on OS)

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

## Troubleshooting
1. Permission shows as missing:
   - `Grant Accessibility` and `Input Monitoring` permissions, then retry in-app (on macOS, if you re-install the app, you may need to manually remove the current permission for the old app, and add the new app manually),
2. Extension disconnected:
   - Check that extension is loaded and `use discuss companion` is enabled aand that the ports match.
3. No active call actions available:
   - Ensure an Odoo call is active in the browser and the extension is connected.
   - Make sure that the major/minor (eg: v1.3.x) of the app and extension match.
4. Linux behavior:
   - X11 is supported; Wayland is not currently supported.

## Related Docs
- [Repository Architecture Overview](../ARCHITECTURE.md)
- [Extension Architecture](../extension/src/ARCHITECTURE.md)
