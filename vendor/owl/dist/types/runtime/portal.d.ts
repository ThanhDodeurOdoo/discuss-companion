import { Component } from "./component";
/**
 * kind of similar to <t t-slot="default"/>, but it wraps it around a VPortal
 */
export declare function portalTemplate(app: any, bdom: any, helpers: any): (ctx: any, node: any, key?: string) => any;
export declare class Portal extends Component {
    static template: string;
    props: import("./props").Props<{
        target: string;
    }>;
    setup(): void;
}
