import { Derived, Opts } from "./computations";
import { ReactiveValue } from "./signal";
export declare function computed<T>(fn: () => T, opts?: Opts): ReactiveValue<T>;
export declare function setSignalHooks(hooks: {
    onDerived: (derived: Derived<any, any>) => void;
}): void;
export declare function resetSignalHooks(): void;
