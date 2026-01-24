interface ResourceOptions<T> {
    name?: string;
    validation?: T;
}
export declare class Resource<T> {
    private _items;
    private _validation?;
    constructor(options?: ResourceOptions<T>);
    items: import("./reactivity/signal").ReactiveValue<T[]>;
    add(item: T, options?: {
        sequence?: number;
    }): Resource<T>;
    delete(item: T): Resource<T>;
    has(item: T): boolean;
}
export declare function useResource<T>(r: Resource<T>, elements: T[]): void;
export {};
