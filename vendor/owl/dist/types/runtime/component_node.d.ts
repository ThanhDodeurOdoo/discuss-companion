import type { App } from "./app";
import { BDom, VNode } from "./blockdom";
import { Component, ComponentConstructor } from "./component";
import { PluginManager } from "./plugins";
import { Computation } from "./reactivity/computations";
import { Fiber, MountFiber, MountOptions } from "./rendering/fibers";
import { STATUS } from "./status";
export declare function saveCurrent(): () => void;
export declare function getCurrent(): ComponentNode;
export declare function useComponent(): Component;
type LifecycleHook = Function;
export declare class ComponentNode implements VNode<ComponentNode> {
    el?: HTMLElement | Text | undefined;
    app: App;
    fiber: Fiber | null;
    component: Component;
    bdom: BDom | null;
    status: STATUS;
    forceNextRender: boolean;
    parentKey: string | null;
    name: string;
    props: Record<string, any>;
    renderFn: Function;
    parent: ComponentNode | null;
    children: {
        [key: string]: ComponentNode;
    };
    willStart: LifecycleHook[];
    willUpdateProps: LifecycleHook[];
    willUnmount: LifecycleHook[];
    mounted: LifecycleHook[];
    willPatch: LifecycleHook[];
    patched: LifecycleHook[];
    willDestroy: LifecycleHook[];
    signalComputation: Computation;
    pluginManager: PluginManager;
    constructor(C: ComponentConstructor, props: Record<string, any>, app: App, parent: ComponentNode | null, parentKey: string | null);
    mountComponent(target: any, options?: MountOptions): void;
    initiateRender(fiber: Fiber | MountFiber): Promise<void>;
    render(deep: boolean): Promise<void>;
    cancel(): void;
    _cancel(): void;
    destroy(): void;
    _destroy(): void;
    updateAndRender(props: Record<string, any>, parentFiber: Fiber): Promise<void>;
    /**
     * Finds a child that has dom that is not yet updated, and update it. This
     * method is meant to be used only in the context of repatching the dom after
     * a mounted hook failed and was handled.
     */
    updateDom(): void;
    firstNode(): Node | undefined;
    mount(parent: HTMLElement, anchor: ChildNode): void;
    moveBeforeDOMNode(node: Node | null, parent?: HTMLElement): void;
    moveBeforeVNode(other: ComponentNode | null, afterNode: Node | null): void;
    patch(): void;
    _patch(): void;
    beforeRemove(): void;
    remove(): void;
}
export {};
