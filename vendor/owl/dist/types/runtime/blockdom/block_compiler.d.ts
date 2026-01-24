import type { VNode } from "./index";
type BlockType = (data?: any[], children?: VNode[]) => VNode;
/**
 * Compiling blocks is a multi-step process:
 *
 * 1. build an IntermediateTree from the HTML element. This intermediate tree
 *    is a binary tree structure that encode dynamic info sub nodes, and the
 *    path required to reach them
 * 2. process the tree to build a block context, which is an object that aggregate
 *    all dynamic info in a list, and also, all ref indexes.
 * 3. process the context to build appropriate builder/setter functions
 * 4. make a dynamic block class, which will efficiently collect references and
 *    create/update dynamic locations/children
 *
 * @param str
 * @returns a new block type, that can build concrete blocks
 */
export declare function createBlock(str: string): BlockType;
export type Setter<T = any> = (this: T, value: any) => void;
export type Updater<T = any> = (this: T, value: any, oldVal: any) => void;
export {};
