# @ensomi/runtime

Apache-2.0 TypeScript runtime for the released Ensomi R2 graphs. Audio features,
grid fitting, figure sampling, prior lookup, R2 controls and release sampling,
chart objects, `.osu`, and `.osz` are implemented in TypeScript. Only the six
networks run through ONNX Runtime. Core source has no Node imports.

**Status:** all four release songs reproduce every sampled choice and all 6,178
hit objects. The strict acceptance gate is **not passed**: Catch the Moment's
full-precision timing-point text differs. See
[`artifacts/parity.json`](artifacts/parity.json) and
[`artifacts/export-divergence.json`](artifacts/export-divergence.json).

## Use

```ts
import { loadModels, decodeAudio, generateChart } from '@ensomi/runtime';

// The base is the directory containing runtime.json and the six ONNX files.
const models = await loadModels(
  'https://huggingface.co/sed-i/ensomi-r2/resolve/main/onnx/'
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
`(relativePath) => Uint8Array`. `localFilesSource(files)` constructs the latter
from browser-selected `File`s. `models.capabilities` uses EnsomiProtocol 0.2's
field names and numeric enum values. File checksums are left empty; the loader
does not make checksum manifests. The runtime targets the released FiLM model
with memory and optional readers off.

`generateChart` accepts mono `Float32Array`/`Float64Array`, or an `AudioPCM` with
interleaved samples and a channel count. Optional `mel` and `beatthis` arrays
are already-decoded mono streams at 24000 and 22050 Hz. The reference has two
PCM streams because Python uses different decoders and normalization for the
two frontends. The Node checks pass both recorded PCM streams, then recompute
all features and model decisions.

`decodeAudio` uses WebAudio `OfflineAudioContext.decodeAudioData` at each of
those two rates and peak-normalizes the Mel stream. Browser codecs, MP3 leading
samples, and WebAudio resampling have not been established as identical to
Python's decoders. For raw PCM without frontend streams, common input rates use
bundled soxr HQ impulse-response FIR tables for BeatThis; other rates use a
windowed-sinc converter. Mel uses linear rate conversion and peak normalization.
The check results cover the recorded PCM path.

`request` follows `GenerateChartRequest`: star in `[2, 6)`, optional unsigned
64-bit seed, title, artist, and `controls` with `long_notes` and nonoverlapping
8–32 second sections. Section targets are a star or a pattern kind/strength.
Use the exported enums. Capabilities retain the Python service's evidence
statuses, including `NOT_WORKING` for chordjack and long-note amount.

The default random source is `mulberry32-u53-v1`: Mulberry32 words form open
53-bit uniforms; figure sampling uses a float32 exponential race and R2 uses
float64 Gumbel maxima. The original seed and the reduced 32-bit rows/R2 seeds
are recorded in `receipt.receipt_json`. R2 starts at seed + 954 and restarts for
each difficulty pass. These seeds intentionally do not reproduce Python's RNG.
A `RandomSource` can be supplied for replay; `checks/replay_random.ts` consumes
recorded variates and asserts chosen indices without supplying those choices
to the decoder.

`options.audio` adds the original encoded audio and receipt to an `.osz` with
fflate. Without it, the result contains the chart, receipt, and `.osu`.
`options.setting` controls the difficulty name (default `r2`), and `trace`
provides optional diagnostic events. The `audio` request field is metadata:
this browser runtime takes PCM directly and does not read local paths.

## Build and check

```sh
cd packages/runtime
npm run build
npm run typecheck
npm run parity
# One song:
npm run parity -- hesitation-snow
```

Checks use onnxruntime-node 1.23.2, CPU, one intra-op and one inter-op thread.
Default data paths are relative to this package and the sibling ensomi-model
repository. Override `ENSOMI_MODEL_DIR`, `ENSOMI_REFERENCE_DIR`, and optionally
`ENSOMI_MODEL_REPO` for another layout. `npm run parity` recomputes everything;
it does not use intermediate files from earlier checks.

The check runs all recorded graph calls first, then the complete public API
with replayed draws and again with the runtime PRNG for each song. It checks
sample choices including discarded difficulty passes, final objects, exact
`.osu` text except the generator comment, zip contents, and chart legality.
Only random variates and input PCM are replayed. Intermediate outputs remain
comparison targets. Graph tolerance is `1e-4`; the grid report includes the
floating error and requires identical whole-ms positions and Mel-frame indices
(`1e-4 ms` numeric tolerance). Continuous grid values are not bit-identical.

Full four-song parity currently exits **1** at stage 5. Catch the Moment,
`[TimingPoints]` row 0, line 15:

```text
Python release: 1659,631.3408705468946,4,2,0,100,1,0
TypeScript:     1659,631.3408705352042,4,2,0,100,1,0
```

The beat-length difference is about `1.17e-8 ms`. Python's own recorded ONNX
replay writes `631.3408705468947` at that same point, also failing the requested
byte equality. TypeScript grid fitting from recorded features reaches that
same last-bit value; the extra difference from PCM comes from frontend float
arithmetic. No sampled choice or exported hit object changes. Exact timing
serialization remains unresolved; no release-specific constants or tolerance
exception were inserted into the exporter.

Large generated files are under ignored `artifacts/bulk/`. Small reports stay
in `artifacts/`. Diagnostic scripts `frontend.ts`, `grid.ts`, `rows.ts`, and
`arrange.ts` can isolate the earlier stages using their saved intermediates.
`python_grid.py` reads the Python implementation without modifying it.
`resampler_coefficients.py` regenerates the generic FIR data using that
repository's soxr installation; it does not consume song data.

## Files and browser handoff

- `src/models.ts`, `binary.ts`, `runtime_assets.ts`: model/file loading and arrays.
- `src/audio.ts`, `fft.ts`, `decode_audio.ts`, `grid.ts`, `fitter/`: PCM and timing.
- `src/rows.ts`, `random.ts`, `strain.ts`: figure decoding and workload.
- `src/prior.ts`, `controls.ts`, `arrange.ts`, `difficulty.ts`, `r2/`: R2 system.
- `src/types.ts`, `capabilities.ts`, `generate.ts`, `export.ts`, `index.ts`: API/export.
- `checks/`: Node replay, stage diagnostics, and coefficient generator.
- `assets/`: FIR coefficients; `artifacts/`: parity and diagnostic reports.

Job 3 still needs the page, file picker, controls, progress/download UI, and
Beatmap Lens integration. Bundle this ESM package, its runtime assets, and
onnxruntime-web's WASM assets. Run generation in a Web Worker to avoid blocking
the UI. Default loading chooses WebGPU plus WASM when `navigator.gpu` exists,
otherwise WASM; `backend: 'wasm'` forces WASM. ONNX Runtime handles operator
placement; there is no runtime retry layer.

Browser provider parity, WebGPU operator coverage for these graphs, WASM memory
use, and browser audio-decode parity remain untested. The graphs use dynamic
time/candidate dimensions and int64 indexing/state. Job 3 must verify their
provider placement and the cost of per-row calls. Serve model/WASM/FIR assets
with suitable CORS and MIME types; configure ORT's WASM paths and threading for
the deployment. Loading all six sessions retains their weights in memory.
No files in the site or ensomi-model were changed.
