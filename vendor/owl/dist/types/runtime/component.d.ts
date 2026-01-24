import type { ComponentNode } from "./component_node";
interface StaticComponentProperties {
    template: string;
    components?: {
        [componentName: string]: ComponentConstructor;
    };
}
export interface ComponentConstructor extends StaticComponentProperties {
    new (node: ComponentNode): Component;
}
export declare class Component {
    static template: string;
    __owl__: ComponentNode;
    constructor(node: ComponentNode);
    setup(): void;
}
export {};
