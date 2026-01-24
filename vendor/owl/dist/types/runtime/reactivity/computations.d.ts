export declare enum ComputationState {
    EXECUTED = 0,
    STALE = 1,
    PENDING = 2
}
export type Computation<T = any> = {
    compute?: () => T;
    state: ComputationState;
    sources: Set<Atom | Derived<any, any>>;
    isEager?: boolean;
    isDerived?: boolean;
    value: T;
    childrenEffect?: Computation[];
} & Opts;
export type Opts = {
    name?: string;
};
export type Atom<T = any> = {
    value: T;
    observers: Set<Computation>;
} & Opts;
export interface Derived<Prev, Next = Prev> extends Atom<Next>, Computation<Next> {
}
export declare function onReadAtom(atom: Atom): void;
export declare function onWriteAtom(atom: Atom): void;
export declare function untrack<T extends (...args: any[]) => any>(fn: T): ReturnType<T>;
export declare function getCurrentComputation(): Computation<any> | undefined;
export declare function setComputation(computation: Computation | undefined): void;
export declare function runWithComputation<T>(computation: Computation, fn: () => T): T;
export declare function updateComputation(computation: Computation): void;
export declare function removeSources(computation: Computation): void;
