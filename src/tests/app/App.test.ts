import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { App as OwlApp, Component, Plugin, plugin } from "@odoo/owl";

jest.unstable_mockModule("@tauri-apps/api/core", () => ({
    __esModule: true,
    invoke: jest.fn()
}));

jest.unstable_mockModule("@tauri-apps/api/event", () => ({
    __esModule: true,
    listen: jest.fn()
}));

await import("@tauri-apps/api/core");
await import("@tauri-apps/api/event");

jest.unstable_mockModule("../../App.xml?raw", () => ({
    __esModule: true,
    default: `<templates xml:space="preserve">
        <t t-name="discuss.Companion">
            <div class="test-app">
                <h1 id="title">Discuss Companion</h1>
                <div class="status-indicators">
                    <span id="perm-status" t-esc="this.app.permissionGranted() ? 'Accessibility Granted' : 'Permission Required'"/>
                </div>
                <button id="toggle-btn" t-on-click="() => this.app.toggleRecording()">Toggle</button>
            </div>
        </t>
    </templates>`
}));

jest.unstable_mockModule("../../app_plugin.ts", () => ({
    __esModule: true,
    AppPlugin: class extends Plugin {
        static id = "AppPlugin";
        permissionGranted = () => false;
        isRecording = () => false;
        toggleRecording = jest.fn();
        setup() {}
    }
}));

const { AppPlugin } = await import("../../app_plugin.ts");

class App extends Component {
    static template = "discuss.Companion";
    app = plugin(AppPlugin);
}

describe("App DOM Tests", () => {
    let target: HTMLElement;
    let owlApp: OwlApp;

    beforeEach(() => {
        jest.clearAllMocks();
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        if (owlApp) {
            owlApp.destroy();
        }
        document.body.removeChild(target);
    });

    test("renders the app correctly", async () => {
        owlApp = new OwlApp({ plugins: [AppPlugin] });
        const template = (await import("../../App.xml?raw")).default;
        owlApp.addTemplates(template);

        await owlApp.createRoot(App).mount(target);

        expect(target.querySelector("#title")?.textContent).toBe("Discuss Companion");
        expect(target.querySelector("#perm-status")?.textContent).toBe("Permission Required");
    });

    test("clicking toggle button calls toggleRecording", async () => {
        let pluginInstance: InstanceType<typeof AppPlugin>;
        const MockedPlugin = class extends Plugin {
            static id = "AppPlugin";
            permissionGranted() {
                return false;
            }
            isRecording() {
                return false;
            }
            toggleRecording = jest.fn();
            setup() {
                pluginInstance = this as unknown as InstanceType<typeof AppPlugin>;
            }
        };

        owlApp = new OwlApp({ plugins: [MockedPlugin] });
        const template = (await import("../../App.xml?raw")).default;
        owlApp.addTemplates(template);

        class TestApp extends Component {
            static template = "discuss.Companion";
            app = plugin(MockedPlugin);
        }

        await owlApp.createRoot(TestApp).mount(target);

        const btn = target.querySelector("#toggle-btn") as HTMLButtonElement;
        btn.click();

        expect(pluginInstance!.toggleRecording).toHaveBeenCalled();
    });
});
