# @ensomi/runtime

The Ensomi R2 chart generator for the browser: the WebAssembly build of Ensomi's
shared Rust runtime ([ensomi-runtime](https://github.com/ensomi-labs/runtime),
private) and its JavaScript API. Audio features, grid fitting, figure sampling,
prior lookup, R2 controls and release sampling, chart objects and `.osu` run in
the Wasm core (`crates/generate`, bound by `crates/generate-wasm`). The six
networks run in ONNX Runtime Web, called from JavaScript; `.osz` is zipped in
JavaScript with fflate. Apache-2.0.

It replaced the TypeScript runtime that lived here until main `9d8e725`. Given
the same inputs both produce the same charts, `.osu` text and receipts, apart
from the runtime's name (see Checks).

## Vendored build

The source is ensomi-runtime. Nothing under `src/` or `pkg/` is edited here.

- `src/`: the JavaScript API, copied from ensomi-runtime `js/src/`.
- `pkg/`: the Wasm core (`ensomi_generate_wasm_bg.wasm`) and its wasm-bindgen
  glue, built from ensomi-runtime into `js/pkg/` and copied.
- `provenance.json`: the ensomi-runtime commit, the build command and the tool
  versions behind `src/` and `pkg/`.
- `assets/`: the soxr resampler tables the core reads for raw PCM at common
  rates when there is no BeatThis stream. `checks/resampler_coefficients.py`
  regenerates them.

`npm run vendor` (`scripts/vendor.sh [ensomi-runtime directory]`) rebuilds,
copies both directories and rewrites `provenance.json`. It needs what
ensomi-runtime's `scripts/wasm-build.sh` needs: Rust with the
`wasm32-unknown-unknown` target and wasm-bindgen-cli 0.2.129. The default
directory is the sibling checkout `../ensomi-runtime`. Where that copy has no
`.git` of its own (bings-mac's synced tree), pass the commit as `RUNTIME_COMMIT`.

## Use

```ts
import { loadModels, decodeAudio, generateChart } from '@ensomi/runtime';

// The base is the directory containing runtime.json and the six ONNX files.
const models = await loadModels(
  'https://huggingface.co/sed-i/ensomi-r2/resolve/main/onnx/',
  { core: '/ensomi-runtime.wasm', wasm: { wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/', numThreads: 1 } }
);
console.log(models.capabilities);

const bytes = await file.arrayBuffer();
const { pcm, sampleRate } = await decodeAudio(bytes);
const result = await generateChart(models, pcm, sampleRate, {
  audio: { asset_id: file.name },
  star: 3.5,
  seed: 0,
  title: 'Song title',
  artist: 'Artist',
}, {
  onProgress: ({ phase }) => console.log(phase),
  audio: { name: file.name, bytes: new Uint8Array(bytes) },
});
// result.chart, result.receipt, result.osu, result.osz
await models.dispose();
```

`loadModels(source, options?)` accepts a base URL or an async function
`(relativePath) => Uint8Array`; `localFilesSource(files)` makes the latter from
browser-selected `File`s. `options.core` is the Wasm core as bytes, a
`WebAssembly.Module` or a URL. Without it the core is fetched from beside the
glue in `pkg/`, which works unbundled in a browser but not in Node or after
bundling; the page copies the `.wasm` to `public/ensomi-runtime.wasm` and passes
that URL. `options.wasm` is applied to ONNX Runtime's `env.wasm` before sessions
are created (`wasmPaths`, `numThreads`). `options.backend` is `webgpu` or
`wasm`, by default WebGPU when `navigator.gpu` exists. With WebGPU only BeatThis
uses it: the rows and R2 graphs run once per beat or head row on small inputs,
where WebGPU's per-call transfers cost more than the CPU. `options.runtimeSource`
reads the resampler tables (default: `assets/` beside `src/`).
`models.capabilities` uses EnsomiProtocol 0.2's field names and numeric enum
values.

`generateChart` accepts mono `Float32Array`/`Float64Array`, or an `AudioPCM` with
interleaved samples and a channel count. Optional `mel` and `beatthis` arrays are
already-decoded mono streams at 24000 and 22050 Hz. `decodeAudio` uses WebAudio
`OfflineAudioContext.decodeAudioData` at each of those two rates and
peak-normalizes the Mel stream. Browser codecs and WebAudio resampling are not
Python's decoders, so browser-decoded audio does not reproduce the Python
release's charts (`artifacts/browser-test/report.md`, D1).

`request` follows `GenerateChartRequest`: star in `[2, 6)`, an unsigned 64-bit
seed (a `bigint` above the safe-number range), title, artist, and `controls`
with `long_notes` and nonoverlapping 8–32 second sections whose targets are a
star or a pattern kind and strength. Capabilities keep the Python service's
evidence statuses, including `NOT_WORKING` for chordjack and long-note amount.

The random source is `mulberry32-u53-v1`, as in the TypeScript runtime; seeds do
not reproduce Python's RNG. `options.replay` takes a core `ReplayDraws` filled
with a release recording's draws, for conformance checks; the core stops at the
first draw that differs. `options.audio` adds the original encoded audio and the
receipt to an `.osz`; `options.setting` sets the difficulty name (default `r2`).
The receipt and the `.osu` comment name the runtime `ensomi-runtime`, where the
TypeScript runtime wrote `@ensomi/runtime`.

## Checks

Run from this directory, with the sibling `ensomi-model` (release model,
runtime-ref recordings, dataset songs) and `ensomi-runtime` checkouts beside
this repository.

```sh
npm run typecheck              # src/index.d.ts against onnxruntime-web's types
npm run typecheck:site
npm run build:site
tests/browser/build-main.sh    # main 9d8e725's TypeScript runtime and page, into artifacts/bulk/main
npm run same-as-ts             # writes artifacts/same-as-ts.json
```

`same-as-ts` runs this package and the TypeScript runtime of main `9d8e725` in
Node on onnxruntime-web's WASM backend with one thread, on the recorded PCM of
the four release songs with seeds 0, 1 and 2, plus a controls case (Hesitation
Snow, seed 1, half long notes and three sections). It compares charts, `.osu`
text and receipts after normalising only the runtime name and the wall-clock
fields. On bings-mac (2026-10-12, the build in `provenance.json`) all 13 cases
are equal and the capabilities are equal. Mean wall time per chart: TypeScript
22.6 s, Wasm 21.2 s, of which BeatThis is about 17 s. The core computes `exp`,
`log` and the other transcendental functions with Rust's `libm` crate, where the
TypeScript runtime used V8's `Math`; their last bits can differ, which on other
input could show in receipt digits or, at a near-tie, a sampled choice.

Replay parity with the Python release is checked in ensomi-runtime
(`conformance/generate/wasm-parity.json`) and in the browser by
`tests/browser/diagnostics.mts wasm control`: all 6,178 hit objects and every
recorded draw on the four songs.

The browser tests and their results are in `tests/browser/README.md` and
`artifacts/browser-test/report.md`. In headless Chrome the page generates the
same seed-0 charts as main's TypeScript build on WebGPU and on WebAssembly, and
the suite passes. Warm generation is faster than main's: new ÷ main 0.87 to
0.96 on WebGPU and 0.94 to 0.97 on WebAssembly per song (median of paired runs).
While BeatThis runs on the GPU, `generateChart` lets the core compute the
Log-Mel spectrogram (`work()`), as the TypeScript runtime did. The renderer's
peak memory is 0.2 to 0.5 GiB higher than main's; the report gives the causes.

## Files

- `src/`, `pkg/`, `provenance.json`: the vendored build; `scripts/vendor.sh` rebuilds it.
- `assets/`: resampler tables; `checks/resampler_coefficients.py` regenerates them.
- `checks/same-as-ts.mjs`: the Node comparison with the TypeScript runtime.
- `tests/browser/`: the page and runtime tests in Chrome.
- `artifacts/`: `same-as-ts.json`, the browser-test report and the speed report of #4.
