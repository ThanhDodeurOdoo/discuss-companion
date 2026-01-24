# Discuss Companion for macOS

[![Systems](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/systems.yml/badge.svg)](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/systems.yml)
[![UI](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/ui.yml/badge.svg)](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/ui.yml)
[![Extension](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/extension.yml/badge.svg)](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/extension.yml)

The Discuss Companion is a macOS companion app for Odoo Discuss. It provides system-wide Push-to-Talk (PTT) capabilities, allowing you to use your PTT key even when the browser is not in focus.

## Architecture

The repository contains 2 parts:
1.  **The Tauri app**:
    -   Captures global key events using macOS Core Graphics APIs and runs a WebSocket server.
    -   front-end built with [Owl v3](https://github.com/odoo/owl).
    -   back-end built with [Rust](https://www.rust-lang.org/).
2.  **The Chrome extension**:
    -   Connects to the desktop agent via WebSockets and relays PTT signals to the Odoo web page.

---

## Development

### Prerequisites

#### Dev:
-  **Rust Toolchain**: [Install Rust](https://rustup.rs/)
-  **flatbuffers**: Required for the `flatbuffers` code generation (if you need to change the protocol).
-  **Node.js**: Version 18+ and `npm`
#### Main:
-  **Google Chrome**: Required for the extension.
-  **macOS**: Required for the `CoreGraphics` event tapping.


### Running Locally
1.  **Install dependencies**:
    ```bash
    npm install
    ```
2.  **Start the app in development mode**:
    ```bash
    npm run dev
    ```

3.  **Permissions**:
    -   On the first run, macOS will prompt for **Accessibility Permissions** (it will appear as permissions to your IDE or whatever spawns the app).
    -   Grant permission in `System Settings` → `Privacy & Security` → `Accessibility`.
    -   Restart the app after granting permission.

---

### Protocol & FlatBuffers

The communication between the App and the Extension uses [FlatBuffers](https://google.github.io/flatbuffers/).
The schema is defined in `protocol.fbs`.

## Extension Setup

To link the app with Odoo:

1.  **Build the Extension**:
    ```bash
    npm run build:extension
    ```
    This will generate the `extension/dist` folder.

2.  **Load in Chrome**:
    1.  Open Chrome and navigate to `chrome://extensions/`.
    2.  Enable **Developer mode** (top right).
    3.  Click **Load unpacked**.
    4.  Select the `extension/dist` folder inside this project (it contains the bundled extension).
    5.  Refresh your Odoo tab.

---

## Deployment & Distribution

### Build for Production
To create a signed macOS `.app` or `.dmg`:
```bash
npm run build:app
```
The output will be generated in `app/backend/target/release/bundle/`.

### Continuous Integration
The project includes three main GitHub Actions suites that run on every push and pull request to `main` and `master`:
- **UI**: Handles frontend linting (ESLint) and app-specific testing. Tests only run if linting passes.
- **Extension**: Handles testing for the Chrome extension components.
- **Systems**: Handles backend (Rust) linting (fmt, clippy) and testing. Tests only run if linting passes.

---

## Usage
1.  Launch the **Discuss Companion**.
2.  Ensure the status indicator says **"Accessibility Granted"**.
3.  In Odoo Discuss, enter a voice call.
4.  The agent will automatically detect your PTT key (Default: **Space**) and activate your microphone in Odoo.
5.  Use the **System Tray** icon (top right of your macOS bar) to Show/Hide the monitoring window or Quit the app.

---

## Security & Privacy
-   The "Event Tap" only listens for the specific key codes configured for PTT.
-   The WebSocket server runs on `localhost:49152` and does not accept external connections.

---

## Contributing
Interested in contributing? Please see our [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on code style, testing, and more.
