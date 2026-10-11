/* tslint:disable */
/* eslint-disable */

/**
 * Recorded random draws, to replay a release recording. Passing it to a generator moves it there.
 */
export class ReplayDraws {
    free(): void;
    [Symbol.dispose](): void;
    add(name: string, kind: string, values: Float64Array, chosen: number): void;
    constructor();
    recorded(): number;
}

export class WasmGenerator {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `samples` is a `Float32Array` or `Float64Array` of interleaved PCM. `resampler` is the array
     * of the three `resamplerFiles` for `sample_rate`, when there is no `beatthis` stream. `request_json`
     * is the request without its seed, which is passed as a BigInt. `clock` returns milliseconds.
     */
    constructor(models: WasmModels, samples: any, channels: number, sample_rate: number, mel: Float32Array | null | undefined, beatthis: Float32Array | null | undefined, resampler: Array<any> | null | undefined, request_json: string, seed: bigint, seed_is_bigint: boolean, setting: string | null | undefined, audio_name: string | null | undefined, clock: Function, replay?: ReplayDraws | null);
    /**
     * The next step. Pass the outputs of the graph the previous step asked for as an object of
     * `{type, dims, data}` by output name, and `undefined` otherwise.
     */
    step(outputs: any): any;
}

export class WasmModels {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * EnsomiProtocol `ModelCapabilities` as JSON.
     */
    capabilities(): string;
    /**
     * `files` maps each path to its bytes (`Uint8Array`).
     */
    constructor(manifest_json: string, files: object);
    /**
     * The files, other than graphs, that `new WasmModels` needs for this `runtime.json`.
     */
    static requiredFiles(manifest_json: string): Array<any>;
    /**
     * The three `resample-*` files for a PCM sample rate the release bundles tables for, or null.
     */
    static resamplerFiles(sample_rate: number): any;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_replaydraws_free: (a: number, b: number) => void;
    readonly __wbg_wasmgenerator_free: (a: number, b: number) => void;
    readonly __wbg_wasmmodels_free: (a: number, b: number) => void;
    readonly replaydraws_add: (a: number, b: number, c: number, d: number, e: number, f: any, g: number) => void;
    readonly replaydraws_new: () => number;
    readonly replaydraws_recorded: (a: number) => number;
    readonly wasmgenerator_new: (a: number, b: any, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: bigint, k: number, l: number, m: number, n: number, o: number, p: any, q: number) => [number, number, number];
    readonly wasmgenerator_step: (a: number, b: any) => [number, number, number];
    readonly wasmmodels_capabilities: (a: number) => [number, number];
    readonly wasmmodels_new: (a: number, b: number, c: any) => [number, number, number];
    readonly wasmmodels_requiredFiles: (a: number, b: number) => [number, number, number];
    readonly wasmmodels_resamplerFiles: (a: number) => any;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
