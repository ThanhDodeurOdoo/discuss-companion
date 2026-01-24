import { Opts } from "./computations";
export type ReactiveValue<T> = () => T;
export interface Signal<T> extends ReactiveValue<T> {
    /**
     * Update the value of the signal with a new value. If the new value is different
     * from the previous values, all computations that depends on this signal will
     * be invalidated, and effects will rerun.
     */
    set(value: T): void;
}
export declare function signal<T>(value: T, opts?: Opts): Signal<T>;
export declare namespace signal {
    var invalidate: (signal: Signal<any>) => void;
    var Array: <T>(initialValue: T[], opts?: Opts) => Signal<T[]>;
    var Object: <T extends object>(initialValue: T, opts?: Opts) => Signal<T>;
    var Map: <K, V>(initialValue: Map<K, V>, opts?: Opts) => Signal<Map<K, V>>;
    var Set: <T>(initialValue: Set<T>, opts?: Opts) => Signal<Set<T>>;
}
