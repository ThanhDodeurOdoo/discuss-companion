type EventHandlerSetter = (this: HTMLElement, data: any) => void;
interface EventHandlerCreator {
    setup: EventHandlerSetter;
    update: EventHandlerSetter;
    remove: (this: HTMLElement) => void;
}
export declare function createEventHandler(rawEvent: string): EventHandlerCreator;
export {};
