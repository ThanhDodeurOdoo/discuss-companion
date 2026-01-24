import type { VNode } from "./index";
declare class VToggler {
    key: string;
    child: VNode;
    parentEl?: HTMLElement | undefined;
    constructor(key: string, child: VNode);
    mount(parent: HTMLElement, afterNode: Node | null): void;
    moveBeforeDOMNode(node: Node | null, parent?: HTMLElement): void;
    moveBeforeVNode(other: VToggler | null, afterNode: Node | null): void;
    patch(other: VToggler, withBeforeRemove: boolean): void;
    beforeRemove(): void;
    remove(): void;
    firstNode(): Node | undefined;
    toString(): string;
}
export declare function toggler(key: string, child: VNode): VNode<VToggler>;
export {};
