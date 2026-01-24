import type { ComponentNode } from "../component_node";
import { Fiber, RootFiber } from "./fibers";
export declare class Scheduler {
    static requestAnimationFrame: ((callback: FrameRequestCallback) => number) & typeof requestAnimationFrame;
    tasks: Set<RootFiber>;
    requestAnimationFrame: Window["requestAnimationFrame"];
    frame: number;
    delayedRenders: Fiber[];
    cancelledNodes: Set<ComponentNode>;
    processing: boolean;
    constructor();
    addFiber(fiber: Fiber): void;
    scheduleDestroy(node: ComponentNode): void;
    /**
     * Process all current tasks. This only applies to the fibers that are ready.
     * Other tasks are left unchanged.
     */
    flush(): void;
    processTasks(): void;
    processFiber(fiber: RootFiber): void;
}
