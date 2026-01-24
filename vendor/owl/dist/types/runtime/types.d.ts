import { ReactiveValue, Signal } from "./reactivity/signal";
type Constructor = {
    new (...args: any[]): any;
};
export type GetOptionalEntries<T> = {
    [K in keyof T as K extends `${infer P}?` ? P : never]?: T[K];
};
export type GetRequiredEntries<T> = {
    [K in keyof T as K extends `${string}?` ? never : K]: T[K];
};
export type PrettifyShape<T> = T extends Function ? T : {
    [K in keyof T]: T[K];
};
type ResolveOptionalEntries<T> = PrettifyShape<GetRequiredEntries<T> & GetOptionalEntries<T>>;
export type KeyedObject<K extends string[]> = {
    [P in K[number]]: any;
};
type ResolveShapedObject<T extends {}> = PrettifyShape<ResolveOptionalEntries<T>>;
export type ResolveObjectType<T extends {}> = ResolveShapedObject<T extends string[] ? KeyedObject<T> : T>;
declare function arrayType(): any[];
declare function arrayType<T>(elementType: T): T[];
declare function constructorType<T extends Constructor>(constructor: T): T;
declare function customValidator<T>(type: T, validator: (value: T) => boolean, errorMessage?: string): T;
declare function functionType(): (...parameters: any[]) => any;
declare function functionType<const P extends any[]>(parameters: P): (...parameters: P) => void;
declare function functionType<const P extends any[], R>(parameters: P, result: R): (...parameters: P) => R;
declare function instanceType<T extends Constructor>(constructor: T): InstanceType<T>;
type LiteralTypes = number | string | boolean | null | undefined;
declare function literalType<const T extends LiteralTypes>(literal: T): T;
declare function objectType(): Record<string, any>;
declare function objectType<const Keys extends string[]>(keys: Keys): ResolveOptionalEntries<KeyedObject<Keys>>;
declare function objectType<Shape extends {}>(shape: Shape): ResolveOptionalEntries<Shape>;
declare function promiseType(): Promise<void>;
declare function promiseType<T>(type: T): Promise<T>;
declare function recordType(): Record<PropertyKey, any>;
declare function recordType<V>(valueType: V): Record<PropertyKey, V>;
declare function tuple<const T extends any[]>(types: T): T;
declare function union<T extends any[]>(types: T): T extends Array<infer E> ? E : never;
declare function signalType(): Signal<any>;
declare function signalType<T>(type: T): Signal<T>;
declare function reactiveValueType(): ReactiveValue<any>;
declare function reactiveValueType<T>(type: T): ReactiveValue<T>;
export declare const types: {
    any: any;
    array: typeof arrayType;
    boolean: boolean;
    constructor: typeof constructorType;
    customValidator: typeof customValidator;
    function: typeof functionType;
    instanceOf: typeof instanceType;
    literal: typeof literalType;
    number: number;
    object: typeof objectType;
    promise: typeof promiseType;
    reactiveValue: typeof reactiveValueType;
    record: typeof recordType;
    signal: typeof signalType;
    string: string;
    tuple: typeof tuple;
    union: typeof union;
};
export {};
