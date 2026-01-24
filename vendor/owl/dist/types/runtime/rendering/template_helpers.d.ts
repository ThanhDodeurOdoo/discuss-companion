import { BDom, toggler, createCatcher } from "../blockdom";
import { markRaw } from "../reactivity/proxy";
import { OwlError } from "../../common/owl_error";
/**
 * This file contains utility functions that will be injected in each template,
 * to perform various useful tasks in the compiled code.
 */
declare function withDefault(value: any, defaultValue: any): any;
declare function callSlot(ctx: any, parent: any, key: string, name: string, dynamic: boolean, extra: any, defaultContent?: (ctx: any, node: any, key: string) => BDom): BDom;
declare function capture(ctx: any): any;
declare function withKey(elem: any, k: string): any;
declare function prepareList(collection: unknown): [unknown[], unknown[], number, undefined[]];
declare function setContextValue(ctx: {
    [key: string]: any;
}, key: string, value: any): void;
declare function toNumber(val: string): number | string;
declare function shallowEqual(l1: any[], l2: any[]): boolean;
declare class LazyValue {
    fn: any;
    ctx: any;
    component: any;
    node: any;
    key: any;
    constructor(fn: any, ctx: any, component: any, node: any, key: any);
    evaluate(): any;
    toString(): any;
}
export declare function safeOutput(value: any, defaultValue?: any): ReturnType<typeof toggler>;
declare function createRef(ref: any): (el: HTMLElement | null, previousEl: HTMLElement | null) => void;
declare function modelExpr(value: any): any;
export declare const helpers: {
    withDefault: typeof withDefault;
    zero: symbol;
    isBoundary: symbol;
    callSlot: typeof callSlot;
    capture: typeof capture;
    withKey: typeof withKey;
    prepareList: typeof prepareList;
    setContextValue: typeof setContextValue;
    shallowEqual: typeof shallowEqual;
    toNumber: typeof toNumber;
    LazyValue: typeof LazyValue;
    safeOutput: typeof safeOutput;
    createCatcher: typeof createCatcher;
    markRaw: typeof markRaw;
    OwlError: typeof OwlError;
    createRef: typeof createRef;
    modelExpr: typeof modelExpr;
};
export {};
