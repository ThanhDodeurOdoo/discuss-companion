# Discuss Companion

[![UI](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/tests-ui.yml/badge.svg)](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/tests-ui.yml)
[![Extension](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/tests-extension.yml/badge.svg)](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/tests-extension.yml)
[![API Tests](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/tests-api.yml/badge.svg)](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/tests-api.yml)

[![macOS](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/tests-macOS.yml/badge.svg)](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/tests-macOS.yml)
[![Windows](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/tests-windows.yml/badge.svg)](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/tests-windows.yml)
[![Ubuntu](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/tests-ubuntu.yml/badge.svg)](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/tests-ubuntu.yml)
[![Debian](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/tests-debian.yml/badge.svg)](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/tests-debian.yml)

[![CodeQuality](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/ThanhDodeurOdoo/discuss-companion/actions/workflows/github-code-scanning/codeql)

The Discuss Companion is a companion app for Odoo Discuss, currently supporting macOS, Windows, and Linux (X11). It provides system-wide Push-to-Talk (PTT) capabilities, allowing you to use your PTT key even when the browser is not in focus, along with convenient quick-access call control features when in a call in Odoo Discuss. This also requires the extension to be installed in a compatible browser (chromium / firefox).

![Discuss Companion Example](assets/example.gif)

The app backend is written in Rust, the app frontend (and the extension) is written in TypeScript using [Owl v3](https://github.com/odoo/owl) as the framework.

### Prerequisites

-  **Browser**: Chromium or Firefox addons compatible browser.
-  **OS**: macOS, Windows, or Linux (X11 only, Wayland not yet supported).

3.  **Permissions**:
    -   On the first run, macOS will prompt for **Accessibility Permissions** (it will appear as permissions to your IDE or whatever spawns the app).
    -   Grant permission in `System Settings` → `Privacy & Security` → `Accessibility`.
    -   Restart the app after granting permission.

## Usage
1.  Launch the **Discuss Companion**.
2.  Ensure the status indicator says **"Accessibility Granted"** (on macOS you need to give both "Accessibility" and "Input Monitoring" permissions).
3.  On the extension, press the gear iconn and check "use discuss companion"
4.  In Odoo Discuss, enter a voice call.
5.  Use the **System Tray** icon to Show/Hide the monitoring window or Quit the app.


## Configuration
The WebSocket port (default: 49152) can be configured if needed (e.g. to avoid conflicts):
-   **App**: Change it directly in the main interface and click "Reload".
-   **Extension**: click the extension icon -> Options -> when "use discuss companion" is checked, an option to change the posrt is available.


## Security & Privacy
 [SECURITY.md](SECURITY.md)

## AI
[Link to the AI policy](.github/CONTRIBUTING.md#general-rules)

## Contributing and running from sources

Interested in contributing or just running the app from sources? Check the [CONTRIBUTING.md](.github/CONTRIBUTING.md).
