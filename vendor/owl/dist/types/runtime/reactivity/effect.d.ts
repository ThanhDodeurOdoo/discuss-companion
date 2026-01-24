import { Opts } from "./computations";
export declare function effect<T>(fn: () => T, opts?: Opts): () => void;
