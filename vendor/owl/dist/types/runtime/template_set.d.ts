import { compile, CustomDirectives, Template, TemplateFunction } from "../compiler";
import { Portal } from "./portal";
export interface TemplateSetConfig {
    dev?: boolean;
    translatableAttributes?: string[];
    translateFn?: (s: string, translationCtx: string) => string;
    templates?: string | Document | Record<string, string>;
    getTemplate?: (s: string) => Element | Function | string | void;
    customDirectives?: CustomDirectives;
    globalValues?: object;
}
export declare class TemplateSet {
    static registerTemplate(name: string, fn: TemplateFunction): void;
    dev: boolean;
    rawTemplates: typeof globalTemplates;
    templates: {
        [name: string]: Template;
    };
    getRawTemplate?: (s: string) => Element | Function | string | void;
    translateFn?: (s: string, translationCtx: string) => string;
    translatableAttributes?: string[];
    Portal: typeof Portal;
    customDirectives: CustomDirectives;
    runtimeUtils: object;
    hasGlobalValues: boolean;
    constructor(config?: TemplateSetConfig);
    addTemplate(name: string, template: string | Element): void;
    addTemplates(xml: string | Document): void;
    getTemplate(name: string): Template;
    _compileTemplate(name: string, template: string | Element): ReturnType<typeof compile>;
    callTemplate(owner: any, subTemplate: string, ctx: any, parent: any, key: any): any;
}
export declare const globalTemplates: {
    [key: string]: string | Element | TemplateFunction;
};
export declare function xml(...args: Parameters<typeof String.raw>): string;
export declare namespace xml {
    var nextId: number;
}
