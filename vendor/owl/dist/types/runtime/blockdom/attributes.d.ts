import type { Setter } from "./block_compiler";
export declare function createAttrUpdater(attr: string): Setter<HTMLElement>;
export declare function attrsSetter(this: HTMLElement, attrs: any): void;
export declare function attrsUpdater(this: HTMLElement, attrs: any, oldAttrs: any): void;
export declare function setClass(this: HTMLElement, val: any): void;
export declare function updateClass(this: HTMLElement, val: any, oldVal: any): void;
