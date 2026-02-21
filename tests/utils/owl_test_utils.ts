import { App, type ComponentConstructor } from "@odoo/owl";
import { screen as testingLibraryScreen, within } from "@testing-library/dom";
import testingLibraryUserEvent from "@testing-library/user-event";

export interface RenderOwlOptions {
    props?: Record<string, unknown>;
    appConfig?: Record<string, unknown>;
    target?: HTMLElement;
}

export type OwlScreen = typeof testingLibraryScreen;
export type OwlUserEvent = typeof testingLibraryUserEvent;

export interface RenderOwlResult<C extends ComponentConstructor> {
    app: App;
    component: InstanceType<C>;
    target: HTMLElement;
    screen: OwlScreen;
    within: ReturnType<typeof within>;
    userEvent: OwlUserEvent;
    destroy: () => void;
}

const trackedApps = new Set<App>();
const ownedTargets = new Set<HTMLElement>();

function createOwlUserEvent<T extends object>(base: T): T {
    return new Proxy(base, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== "function") {
                return value;
            }
            if (String(prop) === "setup") {
                return (...args: unknown[]) => {
                    const instance = value.apply(target, args);
                    return createOwlUserEvent(instance);
                };
            }
            return async (...args: unknown[]) => {
                const result = value.apply(target, args);
                if (result && typeof (result as Promise<unknown>).then === "function") {
                    await result;
                }
                await nextOwlTick();
                return result;
            };
        }
    });
}

export const screen: OwlScreen = testingLibraryScreen;
export const userEvent: OwlUserEvent = createOwlUserEvent(testingLibraryUserEvent);

function getDocument(): Document {
    if (typeof document === "undefined") {
        throw new Error("renderOwl requires a DOM-like environment");
    }
    return document;
}

function destroyApp(app: App) {
    if (!trackedApps.has(app)) {
        return;
    }
    trackedApps.delete(app);
    app.destroy();
}

function removeOwnedTarget(target: HTMLElement) {
    if (!ownedTargets.has(target)) {
        return;
    }
    ownedTargets.delete(target);
    if (target.isConnected) {
        target.remove();
    }
}

export function createOwlTestApp(appConfig: Record<string, unknown> = {}): App {
    const app = new App({
        test: true,
        ...appConfig
    });
    trackedApps.add(app);
    return app;
}

export async function renderOwl<C extends ComponentConstructor>(
    Component: C,
    options: RenderOwlOptions = {}
): Promise<RenderOwlResult<C>> {
    const doc = getDocument();
    const ownsTarget = !options.target;
    const target = options.target ?? doc.createElement("div");
    if (ownsTarget) {
        doc.body.appendChild(target);
        ownedTargets.add(target);
    }
    const app = new App(options.appConfig ?? {});
    trackedApps.add(app);
    const root = app.createRoot(Component, { props: options.props as never });
    const component = await root.mount(target);

    return {
        app,
        component,
        target,
        screen,
        within: within(target),
        userEvent,
        destroy: () => {
            destroyApp(app);
            if (ownsTarget) {
                removeOwnedTarget(target);
            }
        }
    };
}

export const render = renderOwl;

export function cleanupOwl(): void {
    for (const app of trackedApps) {
        app.destroy();
    }
    trackedApps.clear();

    for (const target of ownedTargets) {
        if (target.isConnected) {
            target.remove();
        }
    }
    ownedTargets.clear();
}

export async function nextOwlTick(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (typeof requestAnimationFrame === "function") {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        return;
    }
    await Promise.resolve();
}

export async function clickOwl(element: HTMLElement): Promise<void> {
    await userEvent.click(element);
}
