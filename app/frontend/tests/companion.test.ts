import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { App as OwlApp, Component, xml } from "@odoo/owl";

// Mock imports
jest.unstable_mockModule("../companion.xml?raw", () => ({
    default: `<templates xml:space="preserve">
    <t t-name="discuss.Companion">
        <Header />
        <main>
            <ControlPage />
            <LogPage />
            <Footer />
        </main>
    </t>
</templates>`
}));

const createMockComponent = (name: string) =>
    class extends Component {
        static template = xml`<div class="${name.toLowerCase()}">Mock ${name}</div>`;
    };

jest.unstable_mockModule("../header", () => ({ Header: createMockComponent("Header") }));
jest.unstable_mockModule("../footer", () => ({ Footer: createMockComponent("Footer") }));
jest.unstable_mockModule("../control_page", () => ({
    ControlPage: createMockComponent("ControlPage")
}));
jest.unstable_mockModule("../log_page", () => ({ LogPage: createMockComponent("LogPage") }));

// Import the component under test after mocking dependencies
const { Companion } = await import("../companion");

describe("Companion Component", () => {
    let target: HTMLElement;
    let owlApp: OwlApp;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        if (owlApp) {
            owlApp.destroy();
        }
        document.body.removeChild(target);
    });

    test("renders all sub-components", async () => {
        owlApp = new OwlApp();
        const template = (await import("../companion.xml?raw")).default;
        owlApp.addTemplates(template);

        await owlApp.createRoot(Companion).mount(target);

        expect(target.querySelector(".header")).toBeTruthy();
        expect(target.querySelector(".header")?.textContent).toBe("Mock Header");

        expect(target.querySelector(".footer")).toBeTruthy();
        expect(target.querySelector(".footer")?.textContent).toBe("Mock Footer");

        expect(target.querySelector(".controlpage")).toBeTruthy();
        expect(target.querySelector(".controlpage")?.textContent).toBe("Mock ControlPage");

        expect(target.querySelector(".logpage")).toBeTruthy();
        expect(target.querySelector(".logpage")?.textContent).toBe("Mock LogPage");

        expect(target.querySelector("main")).toBeTruthy();
    });
});
