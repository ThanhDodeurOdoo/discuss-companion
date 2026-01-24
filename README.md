# Discuss Companion for macOS

[![Systems](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/systems.yml/badge.svg)](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/systems.yml)
[![UI](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/ui.yml/badge.svg)](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/ui.yml)
[![Extension](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/extension.yml/badge.svg)](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/extension.yml)

The Discuss Companion is a macOS companion app for Odoo Discuss. It provides system-wide Push-to-Talk (PTT) capabilities, allowing you to use your PTT key even when the browser is not in focus.

## Architecture

The system consists of three parts:
1.  **Tauri App (Rust Backend)**: Captures global key events using macOS Core Graphics APIs and runs a WebSocket server.
2.  **Tauri App (Vite Frontend)**, built with [Owl v3](https://github.com/odoo/owl).
3.  **Chrome Extension**: Connects to the desktop agent via WebSockets and relays PTT signals to the Odoo web page.

---

## Development

### Prerequisites
-   **Rust Toolchain**: [Install Rust](https://rustup.rs/)
-   **Node.js**: Version 18+ and `npm`
-   **macOS**: Required for the `CoreGraphics` event tapping.

### Running Locally
1.  **Install dependencies**:
    ```bash
    npm install
    ```
2.  **Start the app in development mode**:
    ```bash
    npm run tauri:dev
    ```

3.  **Permissions**:
    -   On the first run, macOS will prompt for **Accessibility Permissions**.
    -   Grant permission in `System Settings` → `Privacy & Security` → `Accessibility`.
    -   Restart the app after granting permission.

### Linting & Code Quality

```bash
# Lint Frontend (TypeScript)
npm run lint

# Check Backend (Rust)
cd app/backend
cargo clippy -- -D warnings
cargo fmt --check
cargo fmt --check
```

### Protocol & FlatBuffers

The communication between the App and the Extension uses [FlatBuffers](https://google.github.io/flatbuffers/).
The schema is defined in `protocol.fbs`.

If you modify `protocol.fbs`, you must regenerate the code:

1.  **Install flatc**:
    ```bash
    brew install flatbuffers
    ```
2.  **Generate Code**:
    ```bash
    flatc --rust -o app/backend/src/flatbuffers protocol.fbs
    flatc --ts -o extension/src protocol.fbs
    ```

---

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
npm run tauri:build
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
