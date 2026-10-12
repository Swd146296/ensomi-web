# Runtime checks

The page generates with [`@ensomi/runtime`](https://www.npmjs.com/package/@ensomi/runtime) 0.2.0 from npm, the
WebAssembly build of Ensomi's shared Rust runtime ([ensomi-labs/runtime](https://github.com/ensomi-labs/runtime),
tag `v0.2.0`) and its JavaScript API over ONNX Runtime Web. The repository root's `package.json` pins it exactly; the
package's README documents the API. This directory holds the checks of that runtime in this site, the browser tests
and their results. Apache-2.0.

The package replaced a vendored copy of the same build, which had replaced the TypeScript runtime of main `9d8e725`.
Given the same inputs the Wasm and TypeScript runtimes produce the same charts, `.osu` text and receipts, apart from
the runtime's name (see Checks).

## How the page uses it

- `site/worker.ts` calls `loadModels` with the core copied to `public/ensomi-runtime.wasm` and the package's soxr
  resampler tables copied to `public/resampler/` (both by `npm run build:site`), since bundling moves the module away
  from the package's own files.
- By default `site/app.ts` decodes the song with the package's `decodeAudio`: WebAudio decodes it at 24000 and
  22050 Hz, and the worker passes both streams to `generateChart`, so the core converts no rate and reads no resampler
  table. WebAudio's resampler is not the Python release's, which moves the beat grid by up to 1.3 ms against the
  release charts.
- With the Exact timing option on, `site/audio.ts` decodes the song again at the file's own sample rate, read from its
  header, and the worker passes that mono PCM to `generateChart`. The core converts it to BeatThis's 22050 Hz with the
  soxr table for that rate, fetched from `public/resampler/`, and to the rows model's 24000 Hz by linear
  interpolation, as the Python release does. The report gives the drift and the cost both ways
  (`artifacts/browser-test/report.md`).
- The page generates the whole chart with `generateChart` and plays it afterwards; it does not use the package's
  streaming API (`prepare`, `Prepared`, `ChartScheduler`).
- Seeds drive the runtime's `mulberry32-u53-v1` generator, not Python's RNG, so a seed does not give the command
  line's chart. The page draws a random seed for seed 0 and shows the seed used.

## Checks

Run from this directory, with the sibling `ensomi-model` (release model, runtime-ref recordings, dataset songs) and
`ensomi-runtime` checkouts beside this repository and `npm ci` done in the repository root.

```sh
npm run typecheck              # the package's index.d.ts against onnxruntime-web's types
npm run typecheck:site
npm run build:site
tests/browser/build-main.sh    # main 9d8e725's TypeScript runtime and page, into artifacts/bulk/main
npm run same-as-ts             # writes artifacts/same-as-ts.json
node --import tsx checks/ln-gaps.mjs   # writes artifacts/ln-gaps.json
```

`same-as-ts` runs the npm package and the TypeScript runtime of main `9d8e725` in Node on onnxruntime-web's WASM
backend with one thread, on the recorded PCM of the four release songs with seeds 0, 1 and 2, plus a controls case
(Hesitation Snow, seed 1, half long notes and three sections). It compares charts, `.osu` text and receipts after
normalising only the runtime name and the wall-clock fields. The core computes `exp`, `log` and the other
transcendental functions with Rust's `libm` crate, where the TypeScript runtime used V8's `Math`; their last bits can
differ, which on other input could show in receipt digits or, at a near-tie, a sampled choice.

`ln-gaps` generates the four release songs from their recorded PCM with seeds 0 to 4, reads the Python release charts,
and counts long-note tails at or after the next head in their lane, gaps under the inspector's drawn head height per
visual speed, and gaps in which the drawn tail cap reaches into the next head with and without the inspector's tail
shortening (`site/player.ts`).

Replay parity with the Python release is checked in ensomi-runtime (`conformance/generate/wasm-parity.json`) and in
the browser by `tests/browser/diagnostics.mts wasm control` (recorded Python PCM) and `wasm native` (the page's
exact-timing decoding of the original audio files). On Hesitation Snow and Adventure every recorded draw is consumed
and all 3,771 hit objects equal the release charts'. The release arranged SaiGetsu and Catch the Moment a second time,
which the runtime does not: there the replay consumes the draws through the first arrangement (1,805 of 3,380 and
1,767 of 3,331) and the chart differs from the release's. ensomi-runtime checks those two against the release's first
arrangement.

The browser tests and their results are in `tests/browser/README.md` and `artifacts/browser-test/report.md`.

## Files

- `checks/same-as-ts.mjs`: the Node comparison with the TypeScript runtime.
- `checks/ln-gaps.mjs`: long-note tails against the next head in their lane.
- `checks/resampler_coefficients.py`: how the soxr tables now shipped in the package's `resampler/` were made; it
  writes them to `assets/` here, for comparison.
- `tests/browser/`: the page and runtime tests in Chrome.
- `artifacts/`: `same-as-ts.json`, the browser-test report and the speed report of #4.
