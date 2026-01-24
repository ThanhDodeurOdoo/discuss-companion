import type { VNode } from "./index";
export declare class VMulti {
    children: (VNode | undefined)[];
    anchors?: Node[] | undefined;
    parentEl?: HTMLElement | undefined;
    isOnlyChild?: boolean | undefined;
    constructor(children: (VNode | undefined)[]);
    mount(parent: HTMLElement, afterNode: Node | null): void;
    moveBeforeDOMNode(node: Node | null, parent?: HTMLElement | undefined): void;
    moveBeforeVNode(other: VMulti | null, afterNode: Node | null): void;
    patch(other: VMulti, withBeforeRemove: boolean): void;
    beforeRemove(): void;
    remove(): void;
    firstNode(): Node | undefined;
    toString(): string;
}
export declare function multi(children: (VNode | undefined)[]): VNode<VMulti>;
