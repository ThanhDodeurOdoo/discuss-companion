import { Props, WithDefaults } from "./props";
import { STATUS } from "./status";
import { GetOptionalEntries } from "./types";
export interface PluginConstructor {
    new (): Plugin;
    id: string;
}
export declare class Plugin {
    private static _shadowId;
    static get id(): string;
    static set id(shadowId: string);
    setup(): void;
}
interface PluginManagerOptions {
    parent?: PluginManager | null;
    plugins?: PluginConstructor[];
    pluginProps?: any;
}
export declare class PluginManager {
    static current: PluginManager | null;
    private children;
    private parent;
    private plugins;
    private onDestroyCb;
    status: STATUS;
    constructor(options?: PluginManagerOptions);
    destroy(): void;
    getPluginById<T extends Plugin>(id: string): T | null;
    getPlugin<T extends PluginConstructor>(pluginType: T): InstanceType<T> | null;
    startPlugins(pluginTypes: PluginConstructor[], pluginProps?: any): Plugin[];
}
export declare function plugin<T extends PluginConstructor>(pluginType: T): InstanceType<T>;
export declare namespace plugin {
    var props: <P extends Record<string, any> = any, D extends GetOptionalEntries<P> = any>(type?: P, defaults?: D) => Props<WithDefaults<P, D>>;
}
export {};
