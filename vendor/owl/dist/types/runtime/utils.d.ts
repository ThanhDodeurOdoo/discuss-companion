export type Callback = () => void;
/**
 * Creates a batched version of a callback so that all calls to it in the same
 * microtick will only call the original callback once.
 *
 * @param callback the callback to batch
 * @returns a batched version of the original callback
 */
export declare function batched(callback: Callback): Callback;
/**
 * Determine whether the given element is contained in its ownerDocument:
 * either directly or with a shadow root in between.
 */
export declare function inOwnerDocument(el?: HTMLElement): boolean;
export declare function validateTarget(target: HTMLElement | ShadowRoot): void;
export declare class EventBus extends EventTarget {
    trigger(name: string, payload?: any): void;
}
export declare function whenReady(fn?: any): Promise<void>;
export declare class Markup extends String {
}
export declare function htmlEscape(str: any): Markup;
export declare function markup(strings: TemplateStringsArray, ...placeholders: unknown[]): Markup;
export declare function markup(value: string): Markup;
