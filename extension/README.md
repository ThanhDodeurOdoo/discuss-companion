# Discuss PTT Agent Extension

Standalone Chrome Extension for Odoo Discuss Push-to-Talk.

## Features
- System-wide Push-to-Talk via Tauri Desktop Agent
- WebSocket communication (no Native Messaging hurdles)
- Automatic discovery for Odoo instances

## Installation (Unpacked)
1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension` folder inside the `discuss-agent-app` directory.

## How it works
This extension connects to a WebSocket server running locally on port `49152` (provided by the Discuss Companion Tauri app). It acts as a bridge between the system-wide key events captured by the desktop app and the Odoo web interface.
