import { BDom } from "../blockdom";
import type { ComponentNode } from "../component_node";
export declare function makeChildFiber(node: ComponentNode, parent: Fiber): Fiber;
export declare function makeRootFiber(node: ComponentNode): Fiber;
export declare class Fiber {
    node: ComponentNode;
    bdom: BDom | null;
    root: RootFiber | null;
    parent: Fiber | null;
    children: Fiber[];
    appliedToDom: boolean;
    deep: boolean;
    childrenMap: ComponentNode["children"];
    constructor(node: ComponentNode, parent: Fiber | null);
    render(): void;
    _render(): void;
}
export declare class RootFiber extends Fiber {
    counter: number;
    willPatch: Fiber[];
    patched: Fiber[];
    mounted: Fiber[];
    locked: boolean;
    complete(): void;
    setCounter(newValue: number): void;
}
type Position = "first-child" | "last-child";
export interface MountOptions {
    position?: Position;
}
export declare class MountFiber extends RootFiber {
    target: HTMLElement;
    position: Position;
    constructor(node: ComponentNode, target: HTMLElement, options?: MountOptions);
    complete(): void;
}
export {};
