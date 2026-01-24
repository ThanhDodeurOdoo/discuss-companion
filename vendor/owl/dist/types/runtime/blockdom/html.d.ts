import type { VNode } from "./index";
declare class VHtml {
    html: string;
    parentEl?: HTMLElement | undefined;
    content: ChildNode[];
    constructor(html: string);
    mount(parent: HTMLElement, afterNode: Node | null): void;
    moveBeforeDOMNode(node: Node | null, parent?: HTMLElement | undefined): void;
    moveBeforeVNode(other: VHtml | null, afterNode: Node | null): void;
    patch(other: VHtml): void;
    beforeRemove(): void;
    remove(): void;
    firstNode(): Node;
    toString(): string;
}
export declare function html(str: string): VNode<VHtml>;
export {};
