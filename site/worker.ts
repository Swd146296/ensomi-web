import { ChartScheduler, GenerationPhase, loadModels, localFilesSource, prepare, urlSource, type FileSource, type Models, type Prepared } from '@ensomi/runtime';

/** Generation worker: loads the model once, runs the audio stages of each song the page decoded as soon as it is
 * chosen, and generates charts from them when asked. */
const ORT_WASM = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';
// The runtime's Wasm core and its resampler tables, copied beside this script by `npm run build:site`. The core reads
// the tables only for exact timing, the three for the song's rate.
const CORE = new URL('ensomi-runtime.wasm', self.location.href), RESAMPLER = urlSource(new URL('resampler/', self.location.href).href);
// Model files are cached by URL under this name; change it when the model URL or the files behind it change. Loading
// deletes the caches of other names, such as `ensomi-r2-1.0`, which held the files of the Hub's main branch.
const CACHE = 'ensomi-r2@r2-1.0';

let models: Models | undefined;
// The song prepared last, by the page's id for it; generations start from its Prepared.
let song: { id: number; prepared: Promise<Prepared> } | undefined;
const post = (message: unknown, transfer: Transferable[] = []) => postMessage(message, { transfer });

// Loading, preparing and generating take turns in the order the page asked, so that they never share the graphs.
let queue: Promise<unknown> = Promise.resolve();
function turn<T>(task: () => Promise<T>) {
    const next = queue.then(task);
    queue = next.catch(() => undefined);
    return next;
}

/** Reads model files through the Cache API, downloading (with progress) only what is missing. */
function cachedSource(base: string): FileSource {
    return async (path) => {
        const url = new URL(path, base).href;
        const cache = await self.caches?.open(CACHE).catch(() => undefined);
        const hit = await cache?.match(url);
        if (hit) {
            const bytes = new Uint8Array(await hit.arrayBuffer());
            post({ type: 'file', path, loaded: bytes.length, size: bytes.length, cached: true });
            return bytes;
        }
        const response = await fetch(url);
        // A missing file rejects with code 'ENOENT', as the runtime's own sources do: a model without
        // ensomi-package.json then loads from its runtime.json.
        if (response.status === 404)
            throw Object.assign(new Error(`Missing model file: ${path}`), { code: 'ENOENT' });
        if (!response.ok || !response.body)
            throw new Error(`Model download failed: ${path} (HTTP ${response.status})`);
        const size = Number(response.headers.get('content-length')) || 0, chunks: Uint8Array[] = [], reader = response.body.getReader();
        let loaded = 0, reported = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            if (performance.now() - reported > 100) {
                reported = performance.now();
                post({ type: 'file', path, loaded, size, cached: false });
            }
        }
        const bytes = new Uint8Array(loaded);
        let at = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, at);
            at += chunk.length;
        }
        post({ type: 'file', path, loaded, size: loaded, cached: false });
        await cache?.put(url, new Response(bytes));
        return bytes;
    };
}

async function webgpuAdapter() {
    try {
        return Boolean(await (navigator as any).gpu?.requestAdapter());
    }
    catch {
        return false;
    }
}

onmessage = async ({ data }: MessageEvent) => {
    try {
        if (data.type === 'load') {
            song = undefined;
            await turn(async () => {
                const start = performance.now();
                await models?.dispose();
                models = undefined;
                await self.caches?.keys().then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)))).catch(() => undefined);
                const source = data.files ? localFilesSource(data.files) : cachedSource(data.base);
                // WebAssembly threads need cross-origin isolation (public/_headers). Next to WebGPU, WebAssembly runs only the
                // per-row graphs, which are fastest on two threads; on its own it also runs BeatThis, which gains up to four.
                const threads = (backend: string) => self.crossOriginIsolated ? Math.min(backend === 'webgpu' ? 2 : 4, navigator.hardwareConcurrency) : 1;
                const load = (backend: 'webgpu' | 'wasm') => loadModels(source, { backend, core: CORE, runtimeSource: RESAMPLER, wasm: { wasmPaths: ORT_WASM, numThreads: threads(backend) } });
                let backend: 'webgpu' | 'wasm' = data.backend !== 'wasm' && await webgpuAdapter() ? 'webgpu' : 'wasm';
                try {
                    models = await load(backend);
                }
                catch (error) {
                    if (backend === 'wasm')
                        throw error;
                    // An adapter does not guarantee a working device or session; WebAssembly needs neither.
                    backend = 'wasm';
                    models = await load(backend);
                }
                post({ type: 'loaded', capabilities: models.capabilities, provider: backend, threads: threads(backend), seconds: (performance.now() - start) / 1000 });
            });
        }
        else if (data.type === 'prepare') {
            // Exact timing sends mono PCM at the song's own rate and the core makes both frontend streams; otherwise
            // WebAudio made them at 24000 and 22050 Hz.
            const pcm = data.rate ? data.pcm : { samples: data.mel, channels: 1, mel: data.mel, beatthis: data.beatthis };
            const marks: number[] = [];
            const prepared = turn(() => prepare(models!, pcm, data.rate ?? 24000, { onProgress: ({ phase }) => {
                marks[phase] = performance.now();
                post({ type: 'phase', id: data.id, phase });
            } }));
            song = { id: data.id, prepared };
            await prepared;
            // The stages' own times, which a receipt from a Prepared leaves out: PCM preparation, then the timing stages.
            post({ type: 'prepared', id: data.id, seconds: { pcm: (marks[GenerationPhase.TIMING] - marks[GenerationPhase.LOADING]) / 1000, timing: (performance.now() - marks[GenerationPhase.TIMING]) / 1000 } });
        }
        else if (data.type === 'generate') {
            // The page asks only for the song it prepared last; a song chosen since then waits for this generation.
            const prepared = song!.prepared;
            const result = await turn(async () => {
                const scheduler = await ChartScheduler.create(models!, await prepared, data.request, { mode: 'whole-chart', audio: data.audio });
                try {
                    scheduler.start(0);
                    for (;;) {
                        const action = await scheduler.work();
                        if (action.kind === 'done') return action.result!;
                    }
                }
                finally {
                    scheduler.free();
                }
            });
            post({ type: 'result', result }, result.osz ? [result.osz.buffer] : []);
        }
    }
    catch (error) {
        post({ type: 'error', during: data.type, id: data.id, message: error instanceof Error ? error.message : `ONNX Runtime stopped with error ${String(error)}` });
    }
};
