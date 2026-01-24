import type { VNode } from "./index";
type EventsSpec = {
    [name: string]: number;
};
type Catcher = (child: VNode, handlers: any[]) => VNode;
export declare function createCatcher(eventsSpec: EventsSpec): Catcher;
export {};
