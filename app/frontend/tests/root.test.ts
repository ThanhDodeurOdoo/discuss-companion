import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { App as OwlApp } from "@odoo/owl";

// Mock Tauri APIs
const invokeMock = jest.fn();
const listenMock = jest.fn(() => Promise.resolve(() => {}));

jest.unstable_mockModule("@tauri-apps/api/core", () => ({
    invoke: invokeMock
}));

jest.unstable_mockModule("@tauri-apps/api/event", () => ({
    listen: listenMock
}));

// Real imports
const { Root } = await import("../root");
const { AppPlugin } = await import("../app_plugin");

describe("Root Integration Tests", () => {
    let target: HTMLElement;
    let owlApp: OwlApp;

    beforeEach(() => {
        jest.clearAllMocks();
        target = document.createElement("div");
        document.body.appendChild(target);

        // Default mock implementations
        invokeMock.mockImplementation((cmd) => {
            if (cmd === "is_extension_connected") {
                return Promise.resolve(false);
            }
            if (cmd === "get_current_binding") {
                return Promise.resolve({ code: 49, modifiers: [] });
            } // Space key
            if (cmd === "get_ws_port") {
                return Promise.resolve(49152);
            }
            if (cmd === "is_accessibility_granted") {
                return Promise.resolve(false);
            }
            return Promise.resolve(null);
        });
    });

    afterEach(() => {
        if (owlApp) {
            owlApp.destroy();
        }
        document.body.removeChild(target);
    });

    async function mountApp() {
        owlApp = new OwlApp({ plugins: [AppPlugin] });
        // Load all templates
        const templates = await Promise.all([
            import("../root.xml?raw"),
            import("../companion.xml?raw"),
            import("../header.xml?raw"),
            import("../footer.xml?raw"),
            import("../control_page.xml?raw"),
            import("../log_page.xml?raw")
        ]);
        templates.forEach((t) => owlApp.addTemplates(t.default));

        await owlApp.createRoot(Root).mount(target);
    }

    test("renders the full app hierarchy", async () => {
        await mountApp();

        // Check for Header title
        const title = target.querySelector("h1");
        expect(title).toBeTruthy();
        expect(title?.textContent).toBe("Discuss Companion");

        // Check for permission status (mocked to false)
        const permStatus = target.querySelectorAll(".status-item")[0];
        expect(permStatus?.textContent).toContain("Permission Required");
    });

    test("mounting initiates initialization calls", async () => {
        await mountApp();
        expect(invokeMock).toHaveBeenCalledWith("get_current_binding");
        expect(invokeMock).toHaveBeenCalledWith("get_ws_port");
        expect(invokeMock).toHaveBeenCalledWith("is_accessibility_granted");
    });
});
