import { GetOptionalEntries, KeyedObject, PrettifyShape, ResolveObjectType } from "./types";
declare const isProps: unique symbol;
export type WithDefaults<T, D> = T & Required<D>;
export type Props<T extends {}> = T & {
    [isProps]: true;
};
type GetPropsDefaults<T extends object> = PrettifyShape<GetOptionalEntries<T>>;
type GetPropsWithOptionals<T> = T extends Props<infer P> ? (P extends WithDefaults<infer R, any> ? R : P) : never;
export type GetProps<T> = {
    [K in keyof T]: T[K] extends {
        [isProps]: true;
    } ? (x: GetPropsWithOptionals<T[K]>) => void : never;
}[keyof T] extends (x: infer I) => void ? {
    [K in keyof I]: I[K];
} : never;
export declare function props(): Props<Record<string, any>>;
export declare function props<const Keys extends string[]>(keys: Keys): Props<ResolveObjectType<Keys>>;
export declare function props<const Keys extends string[], Defaults extends GetPropsDefaults<KeyedObject<Keys>>>(keys: Keys, defaults: Defaults): Props<WithDefaults<ResolveObjectType<Keys>, GetPropsDefaults<KeyedObject<Keys>>>>;
export declare function props<Shape extends {}>(shape: Shape): Props<ResolveObjectType<Shape>>;
export declare function props<Shape extends {}, Defaults extends GetPropsDefaults<Shape>>(shape: Shape, defaults: Defaults): Props<WithDefaults<ResolveObjectType<Shape>, GetPropsDefaults<Shape>>>;
export {};
