import type { VNode } from "./index";
declare abstract class VSimpleNode {
    text: string | String;
    parentEl?: HTMLElement | undefined;
    el?: any;
    constructor(text: string | String);
    mountNode(node: Node, parent: HTMLElement, afterNode: Node | null): void;
    moveBeforeDOMNode(node: Node | null, parent?: HTMLElement | undefined): void;
    moveBeforeVNode(other: VText | null, afterNode: Node | null): void;
    beforeRemove(): void;
    remove(): void;
    firstNode(): Node;
    toString(): string | String;
}
declare class VText extends VSimpleNode {
    mount(parent: HTMLElement, afterNode: Node | null): void;
    patch(other: VText): void;
}
declare class VComment extends VSimpleNode {
    mount(parent: HTMLElement, afterNode: Node | null): void;
    patch(): void;
}
export declare function text(str: string | String): VNode<VText>;
export declare function comment(str: string): VNode<VComment>;
export declare function toText(value: any): string;
export {};
