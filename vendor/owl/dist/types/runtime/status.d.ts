export declare const enum STATUS {
    NEW = 0,
    MOUNTED = 1,// is ready, and in DOM. It has a valid el
    CANCELLED = 2,
    DESTROYED = 3
}
type STATUS_DESCR = "new" | "started" | "mounted" | "cancelled" | "destroyed";
export declare function status(): () => STATUS_DESCR;
export {};
