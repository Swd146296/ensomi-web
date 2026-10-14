# Runtime checks

The page generates with [`@ensomi/runtime`](https://www.npmjs.com/package/@ensomi/runtime) 0.3.0 from npm, the
WebAssembly build of Ensomi's shared Rust runtime ([ensomi-labs/runtime](https://github.com/ensomi-labs/runtime),
tag `v0.3.0`) and its JavaScript API over ONNX Runtime Web. The repository root's `package.json` pins it exactly; the
package's README documents the API. This directory holds the checks of that runtime in this site, the browser tests
and their results. Apache-2.0.

The package replaced a vendored copy of the same build, which had replaced the TypeScript runtime of main `9d8e725`.
From 0.2.0 the runtime arranges a song once. The TypeScript runtime, like the Python release, arranged it a second
time when the first arrangement missed the star's difficulty target, so their charts differ wherever it did.

## How the page uses it

- `site/worker.ts` calls `loadModels` with the core copied to `public/ensomi-runtime.wasm` and the package's soxr
  resampler tables copied to `public/resampler/` (both by `npm run build:site`), since bundling moves the module away
  from the package's own files. The model's files come through the Cache API (`cachedSource`), which rejects an
  HTTP 404 with `code` `'ENOENT'` as the package's own sources do, so a model without `ensomi-package.json` loads from
  its `runtime.json`. With the manifest the runtime checks every file's SHA-256.
- By default `site/app.ts` decodes the song with the package's `decodeAudio`: WebAudio decodes it at 24000 and
  22050 Hz, and the worker passes both streams to `prepare`, so the core converts no rate and reads no resampler
  table. WebAudio's resampler is not the Python release's, which moves the beat grid by up to 1.3 ms against the
  release charts.
- With the Exact timing option on, `site/audio.ts` decodes the song again at the file's own sample rate, read from its
  header, and the worker passes that mono PCM to `prepare`. The core converts it to BeatThis's 22050 Hz with the
  soxr table for that rate, fetched from `public/resampler/`, and to the rows model's 24000 Hz by linear
  interpolation, as the Python release does. The report gives the drift and the cost both ways
  (`artifacts/browser-test/report.md`).
- As soon as the model is loaded and a song decoded, the worker runs the song's audio stages with `prepare` (PCM,
  BeatThis, the features and the beat grid), and again when Exact timing is toggled; nothing else runs until Generate.
  Generate makes the whole chart from that `Prepared` with `ChartScheduler` in `'whole-chart'` mode, which gives
  `generateChart`'s chart and `.osu` (`checks/prepare-equal.mjs`), and the page plays it afterwards. Loading,
  preparing and generating take turns in the worker. A receipt from a `Prepared` times only the stages after timing;
  the page times the audio stages from `prepare`'s progress and shows them in its times table.
- Seeds drive the runtime's `mulberry32-u53-v1` generator, not Python's RNG, so a seed does not give the command
  line's chart. As in the app, a blank seed field draws a random seed, which the page shows with the result; 0 is a
  seed like any other.

## Checks

Run from this directory, with the sibling `ensomi-model` (release model, runtime-ref recordings, dataset songs) and
`ensomi-runtime` checkouts beside this repository and `npm ci` done in the repository root.

```sh
npm run typecheck              # the package's index.d.ts against onnxruntime-web's types
npm run typecheck:site
npm run build:site
node --import tsx checks/ln-gaps.mjs   # writes artifacts/ln-gaps.json
node checks/prepare-equal.mjs           # writes artifacts/browser-test/prepare-equal.json
```

`prepare-equal` generates Catch the Moment and Hesitation Snow from their recorded PCM with `generateChart` and with
`prepare` then `ChartScheduler` (`'whole-chart'`), as the page does, at seed 1 and at seed 7 with a section, and
fails unless each pair has the same chart and `.osu`.

`ln-gaps` generates the four release songs from their recorded PCM with seeds 0 to 4, reads the Python release charts,
and counts long-note tails at or after the next head in their lane, gaps under the inspector's drawn head height per
visual speed, and gaps in which the drawn tail cap reaches into the next head with and without the inspector's tail
shortening (`site/player.ts`).

Replay parity with the Python release is checked in ensomi-runtime (`conformance/generate/wasm-parity.json`) and in
the browser by `tests/browser/diagnostics.mts wasm control` (recorded Python PCM) and `wasm native` (the page's
exact-timing decoding of the original audio files): all 6,028 hit objects and every draw the runtime makes on the four
songs. The runtime arranges a song once; where the release arranged it a second time (SaiGetsu and Catch the Moment),
the reference is the chart of the release's first arrangement, as in ensomi-runtime's `js/checks/replay.mjs`.

The browser tests and their results are in `tests/browser/README.md` and `artifacts/browser-test/report.md`.

## Files

- `checks/ln-gaps.mjs`: long-note tails against the next head in their lane.
- `checks/resampler_coefficients.py`: how the soxr tables now shipped in the package's `resampler/` were made; it
  writes them to `assets/` here, for comparison.
- `tests/browser/`: the page and runtime tests in Chrome.
- `artifacts/`: `ln-gaps.json`, the browser-test report and the speed report of #4.
