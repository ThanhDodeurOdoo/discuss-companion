import { ComponentConstructor } from "./component";
import { ComponentNode } from "./component_node";
import { handleError } from "./rendering/error_handling";
import { Fiber, MountOptions, RootFiber } from "./rendering/fibers";
import { Plugin, PluginManager } from "./plugins";
import { proxy, toRaw } from "./reactivity/proxy";
import { Scheduler } from "./rendering/scheduler";
import { TemplateSet, TemplateSetConfig } from "./template_set";
import { validateTarget } from "./utils";
import { GetProps } from "./props";
type ComponentInstance<C extends ComponentConstructor> = C extends new (...args: any) => infer T ? T : never;
interface RootConfig<P> {
    pluginManager?: PluginManager;
    props?: P;
}
export interface AppConfig extends TemplateSetConfig {
    name?: string;
    plugins?: (typeof Plugin)[];
    pluginManager?: PluginManager;
    test?: boolean;
}
declare global {
    interface Window {
        __OWL_DEVTOOLS__: {
            apps: Set<App>;
            Fiber: typeof Fiber;
            RootFiber: typeof RootFiber;
            toRaw: typeof toRaw;
            proxy: typeof proxy;
        };
    }
}
type MountTarget = HTMLElement | ShadowRoot;
interface Root<T extends ComponentConstructor> {
    node: ComponentNode;
    promise: Promise<ComponentInstance<T>>;
    mount(target: MountTarget, options?: MountOptions): Promise<ComponentInstance<T>>;
    destroy(): void;
}
export declare class App extends TemplateSet {
    static validateTarget: typeof validateTarget;
    static __current: App | null;
    static apps: Set<App>;
    static version: string;
    name: string;
    scheduler: Scheduler;
    roots: Set<Root<any>>;
    pluginManager: PluginManager;
    constructor(config?: AppConfig);
    createRoot<T extends ComponentConstructor>(Root: T, config?: RootConfig<GetProps<ComponentInstance<T>>>): Root<T>;
    makeNode<T extends ComponentConstructor>(Component: T, props: GetProps<ComponentInstance<T>>): ComponentNode;
    mountNode(node: ComponentNode, target: HTMLElement | ShadowRoot, resolve: (c: any) => void, reject: (e: any) => void, options?: MountOptions): void;
    destroy(): void;
    createComponent<P extends Record<string, any>>(name: string | null, isStatic: boolean, hasSlotsProp: boolean, hasDynamicPropList: boolean, propList: string[]): (props: P, key: string, ctx: ComponentNode, parent: any, C: any) => any;
    handleError(...args: Parameters<typeof handleError>): void;
}
export declare function mount<T extends ComponentConstructor>(C: T, target: MountTarget, config?: AppConfig & RootConfig<GetProps<ComponentInstance<T>>> & MountOptions): Promise<ComponentInstance<T>>;
export {};
