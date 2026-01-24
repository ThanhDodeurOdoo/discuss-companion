import type { TemplateSet } from "../runtime/template_set";
import type { BDom } from "../runtime/blockdom";
import { Config } from "./code_generator";
export type CustomDirectives = Record<string, (node: Element, value: string, modifier: string[]) => void>;
export type Template = (context: any, vnode: any, key?: string) => BDom;
export type TemplateFunction = (app: TemplateSet, bdom: any, helpers: any) => Template;
interface CompileOptions extends Config {
    name?: string;
    customDirectives?: CustomDirectives;
    hasGlobalValues: boolean;
}
export declare function compile(template: string | Element, options?: CompileOptions): TemplateFunction;
export {};
