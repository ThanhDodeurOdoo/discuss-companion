import type { ComponentNode } from "../component_node";
import type { Fiber } from "./fibers";
export declare const fibersInError: WeakMap<Fiber, any>;
export declare const nodeErrorHandlers: WeakMap<ComponentNode, ((error: any, finalize: Function) => void)[]>;
type ErrorParams = {
    error: any;
} & ({
    node: ComponentNode;
} | {
    fiber: Fiber;
});
export declare function handleError(params: ErrorParams): void;
export {};
