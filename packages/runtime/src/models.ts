import { arrayFromBytes, tensorType, type ArraySpec, type NumericArray } from './binary.js';
import { capabilities } from './capabilities.js';
import { runtimeAssetSource } from './runtime_assets.js';
import type * as ORT from 'onnxruntime-web';
export type Ort = typeof ORT;
export type FileSource = (relativePath: string) => Promise<Uint8Array>;
export interface GraphSpec {
    file: string;
    inputs: {
        name: string;
        dtype: string;
        shape: (number | string)[];
    }[];
    outputs: {
        name: string;
        dtype: string;
        shape: (number | string)[];
    }[];
}
export interface Manifest {
    format: string;
    precision: string;
    graphs: Record<string, GraphSpec>;
    state: {
        r2_initial: Record<string, ArraySpec>;
        r2_commit_outputs: Record<string, string>;
        rows_hidden_shape: number[];
        rows_initial_previous: number;
    };
    frontend_arrays: {
        beatthis: Record<string, ArraySpec>;
        rows: Record<string, any>;
    };
    beatthis_frontend: Record<string, any>;
    rows_frontend: Record<string, any>;
    grid_fitter: Record<string, any>;
    constants: Record<string, any>;
    rows: Record<string, any>;
    r2: Record<string, any>;
    calibration: Record<string, any>;
    prior: Record<string, any>;
    system: Record<string, any>;
    decode_literals: Record<string, any>;
    sampling: Record<string, any>;
}
export function urlSource(baseUrl: string): FileSource {
    const base = baseUrl.replace(/\/$/, '') + '/';
    return async (path) => {
        const response = await fetch(new URL(path, base));
        if (!response.ok)
            throw new Error(`Model download failed: ${path} (${response.status})`);
        return new Uint8Array(await response.arrayBuffer());
    };
}
export function localFilesSource(files: Iterable<File>): FileSource {
    const entries = new Map(Array.from(files, f => [f.name, f]));
    return async (path) => {
        const file = entries.get(path) ?? entries.get(path.split('/').pop()!);
        if (!file)
            throw new Error(`Missing model file: ${path}`);
        return new Uint8Array(await file.arrayBuffer());
    };
}
/** Graphs that use WebGPU when it is available. The other graphs run once per beat or head row on small
 * inputs, where WebGPU's per-call transfers cost more than computing on the CPU. */
const GPU_GRAPHS = new Set(['beatthis']);
export class Models {
    readonly capabilities;
    private readonly arrays = new Map<string, Promise<NumericArray>>();
    constructor(readonly manifest: Manifest, readonly ort: Ort, readonly sessions: Record<string, ORT.InferenceSession>, readonly source: FileSource, readonly runtimeSource: FileSource = runtimeAssetSource) {
        this.capabilities = capabilities(Object.values(manifest.graphs).map(g => g.file));
    }
    /** Reads an array once; later calls share it, so callers must not modify it. */
    array(spec: ArraySpec): Promise<NumericArray> {
        const path = (spec.file ?? spec.path)!;
        let array = this.arrays.get(path);
        if (!array) {
            array = this.source(path).then(bytes => arrayFromBytes(bytes, spec.dtype));
            array.catch(() => this.arrays.delete(path));
            this.arrays.set(path, array);
        }
        return array;
    }
    async tensor(spec: ArraySpec) { return new this.ort.Tensor(tensorType(spec.dtype) as ORT.Tensor.Type, await this.array(spec) as any, spec.shape); }
    run(name: string, feeds: Record<string, ORT.Tensor>) { return this.sessions[name].run(feeds); }
    async dispose() { for (const session of Object.values(this.sessions))
        await session.release(); }
}
export async function loadModels(source: FileSource | string, options: {
    ort?: Ort;
    session?: ORT.InferenceSession.SessionOptions;
    backend?: 'webgpu' | 'wasm';
    /** ORT WebAssembly settings applied before sessions are created, e.g. wasmPaths and numThreads. */
    wasm?: Partial<ORT.Env.WebAssemblyFlags>;
    runtimeSource?: FileSource;
} = {}): Promise<Models> {
    const read = typeof source === 'string' ? urlSource(source) : source;
    const manifest = JSON.parse(new TextDecoder().decode(await read('runtime.json'))) as Manifest;
    if (manifest.format !== 'ensomi-onnx-runtime-v1')
        throw new Error(`Unsupported runtime format: ${manifest.format}`);
    if (manifest.r2.config.memory !== 'none' || manifest.r2.config.conditioner !== 'film' || ['ln_level', 'ln_length', 'anchor', 'theta'].some(key => manifest.r2.config[key] !== 'off')) {
        throw new Error('This runtime supports the released R2 FiLM model with memory and optional readers off');
    }
    const backend = options.backend ?? (typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm');
    const ort = options.ort ?? (backend === 'webgpu' ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm'));
    if (options.wasm)
        Object.assign(ort.env.wasm, options.wasm);
    const models = new Models(manifest, ort, {}, read, options.runtimeSource);
    // All files download at once, with the Mel filters, windows and R2 initial state that generation reads first.
    // Sessions are created in order, each as soon as its file has arrived.
    const graphs = Object.entries(manifest.graphs), reads = graphs.map(([, graph]) => read(graph.file));
    const create = (async () => {
        for (const [i, [name]] of graphs.entries())
            models.sessions[name] = await ort.InferenceSession.create(await reads[i], options.session ?? { executionProviders: backend === 'webgpu' && GPU_GRAPHS.has(name) ? ['webgpu', 'wasm'] : ['wasm'] });
    })();
    const { beatthis, rows } = manifest.frontend_arrays, arrays = [beatthis.hann_window, beatthis.mel_filter, rows.hann_window, rows.mel_filter, ...Object.values(manifest.state.r2_initial)];
    try {
        await Promise.all([create, ...reads, ...arrays.map(spec => models.array(spec))]);
    }
    catch (error) {
        await create.catch(() => undefined);
        await models.dispose();
        throw error;
    }
    return models;
}
