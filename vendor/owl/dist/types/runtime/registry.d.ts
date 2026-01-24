interface RegistryOptions<T> {
    name?: string;
    validation?: T;
}
export declare class Registry<T> {
    private _map;
    private _name;
    private _validation?;
    constructor(options?: RegistryOptions<T>);
    entries: import("./reactivity/signal").ReactiveValue<[string, T][]>;
    items: import("./reactivity/signal").ReactiveValue<T[]>;
    addById<U extends {
        id: string;
    } & T>(item: U, options?: {
        sequence?: number;
    }): Registry<T>;
    add(key: string, value: T, options?: {
        sequence?: number;
    }): Registry<T>;
    get(key: string, defaultValue?: T): T;
    delete(key: string): void;
    has(key: string): boolean;
}
export {};
