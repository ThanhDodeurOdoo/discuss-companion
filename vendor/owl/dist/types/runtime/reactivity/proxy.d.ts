import { Atom } from "./computations";
type Target = object;
type Reactive<T extends Target> = T;
/**
 * Mark an object or array so that it is ignored by the reactivity system
 *
 * @param value the value to mark
 * @returns the object itself
 */
export declare function markRaw<T extends Target>(value: T): T;
/**
 * Given a proxy objet, return the raw (non proxy) underlying object
 *
 * @param value a proxy value
 * @returns the underlying value
 */
export declare function toRaw<T extends Target, U extends Reactive<T>>(value: U | T): T;
export declare const targets: WeakMap<object, object>;
export declare function proxifyTarget<T extends Target>(target: T, atom: Atom | null): T;
/**
 * Creates a reactive proxy for an object. Reading data on the proxy object
 * subscribes to changes to the data. Writing data on the object will cause the
 * notify callback to be called if there are suscriptions to that data. Nested
 * objects and arrays are automatically made reactive as well.
 *
 * Whenever you are notified of a change, all subscriptions are cleared, and if
 * you would like to be notified of any further changes, you should go read
 * the underlying data again. We assume that if you don't go read it again after
 * being notified, it means that you are no longer interested in that data.
 *
 * Subscriptions:
 * + Reading a property on an object will subscribe you to changes in the value
 *    of that property.
 * + Accessing an object's keys (eg with Object.keys or with `for..in`) will
 *    subscribe you to the creation/deletion of keys. Checking the presence of a
 *    key on the object with 'in' has the same effect.
 * - getOwnPropertyDescriptor does not currently subscribe you to the property.
 *    This is a choice that was made because changing a key's value will trigger
 *    this trap and we do not want to subscribe by writes. This also means that
 *    Object.hasOwnProperty doesn't subscribe as it goes through this trap.
 *
 * @param target the object for which to create a proxy proxy
 * @param callback the function to call when an observed property of the
 *  proxy has changed
 * @returns a proxy that tracks changes to it
 */
export declare function proxy<T extends Target>(target: T): T;
export {};
