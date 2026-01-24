import type { VNode } from "./index";
declare class VList {
    children: VNode[];
    anchor: Node | undefined;
    parentEl?: HTMLElement | undefined;
    isOnlyChild?: boolean | undefined;
    constructor(children: VNode[]);
    mount(parent: HTMLElement, afterNode: Node | null): void;
    moveBeforeDOMNode(node: Node | null, parent?: HTMLElement | undefined): void;
    moveBeforeVNode(other: VList | null, afterNode: Node | null): void;
    patch(other: VList, withBeforeRemove: boolean): void;
    beforeRemove(): void;
    remove(): void;
    firstNode(): Node | undefined;
    toString(): string;
}
export declare function list(children: VNode[]): VNode<VList>;
export {};
