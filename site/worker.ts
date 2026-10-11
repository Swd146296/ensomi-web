import { generateChart, loadModels, localFilesSource, type FileSource, type Models } from '../packages/runtime/src/index.js';

/** Generation worker: loads the model once, then generates charts from PCM the page decoded. */
const ORT_WASM = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';
// The runtime's Wasm core, copied beside this script by `npm run build:site`.
const CORE = new URL('ensomi-runtime.wasm', self.location.href);
// Model files are cached by URL under this name; change it when the files behind the model URL change.
const CACHE = 'ensomi-r2-1.0';

let models: Models | undefined;
const post = (message: unknown, transfer: Transferable[] = []) => postMessage(message, { transfer });

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
            const start = performance.now();
            await models?.dispose();
            models = undefined;
            const source = data.files ? localFilesSource(data.files) : cachedSource(data.base);
            // WebAssembly threads need cross-origin isolation (public/_headers). Next to WebGPU, WebAssembly runs only the
            // per-row graphs, which are fastest on two threads; on its own it also runs BeatThis, which gains up to four.
            const threads = (backend: string) => self.crossOriginIsolated ? Math.min(backend === 'webgpu' ? 2 : 4, navigator.hardwareConcurrency) : 1;
            const load = (backend: 'webgpu' | 'wasm') => loadModels(source, { backend, core: CORE, wasm: { wasmPaths: ORT_WASM, numThreads: threads(backend) } });
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
        }
        else if (data.type === 'generate') {
            const pcm = { samples: data.mel, channels: 1, mel: data.mel, beatthis: data.beatthis };
            const result = await generateChart(models!, pcm, 24000, data.request, { audio: data.audio, onProgress: ({ phase }) => post({ type: 'phase', phase }) });
            post({ type: 'result', result }, result.osz ? [result.osz.buffer] : []);
        }
    }
    catch (error) {
        post({ type: 'error', during: data.type, message: error instanceof Error ? error.message : `ONNX Runtime stopped with error ${String(error)}` });
    }
};
