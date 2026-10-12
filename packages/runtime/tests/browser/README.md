# Ensomi browser checks

Run from `packages/runtime` with Homebrew Node on PATH. These tests do not edit product code. They create evidence in `artifacts/browser-test/`; binaries, downloads, per-frame data, and large logs are confined to its `bulk/` directory. Chrome runs headless; `ENSOMI_HEADED=1` opens windows.

```sh
export PATH=/opt/homebrew/bin:$PATH
npm run build:site
npm run typecheck:site
npm run serve:site -- 8087 ../ensomi-model/artifacts/release-r2/bulk/hf/ensomi-r2   # npm runs scripts in the repository root
```

In a second terminal, from `packages/runtime`:

```sh
node tests/browser/page-matrix.mjs webgpu local
ENSOMI_PLAYER=1 node tests/browser/page-matrix.mjs wasm local
node tests/browser/page-matrix.mjs webgpu hf
node tests/browser/page-matrix.mjs wasm hf
node tests/browser/page-matrix.mjs webgpu folder
node tests/browser/page-matrix.mjs webgpu hf adventure
node tests/browser/page-matrix.mjs wasm hf adventure
node tests/browser/mobile.mjs
node tests/browser/hero-contrast.mjs
../../../ensomi-model/.venv/bin/python tests/browser/hero-contrast.py  # Pillow
node tests/browser/wheel.mjs
ENSOMI_PLAYER=1 node tests/browser/wheel.mjs
node tests/browser/links.mjs
node tests/browser/fallback.mjs
node --import tsx tests/browser/diagnostics.mts webgpu networks
node --import tsx tests/browser/diagnostics.mts wasm networks
node --import tsx tests/browser/diagnostics.mts webgpu compare
node --import tsx tests/browser/diagnostics.mts wasm replay
node --import tsx tests/browser/diagnostics.mts wasm pcm
node --import tsx tests/browser/diagnostics.mts wasm control
node tests/browser/grid-drift.mjs <label>
node tests/browser/tail-screenshot.mjs <name>
node tests/browser/load-benchmark.mjs
python3 tests/browser/validate-downloads.py
```

Prerequisites: `npm ci` in the repository root, installed Google Chrome, the sibling `ensomi-model` repository with release model, four dataset songs, and runtime-reference recordings. `ENSOMI_MODEL_DIR` and `ENSOMI_TEST_URL` override the page test's model directory and URL. Keep timing runs sequential.

`page-matrix.mjs` uses the actual built page, file/directory inputs, and both download links. It observes worker messages without changing computation. Cold means a fresh browser context with an empty Cache API; warm means a reload of that context after all model assets have been used. An optional fourth argument selects one song, allowing Adventure to be the first generation in its session. Generations use seed 1; local runs of all songs also generate with seed 0 and check that the page shows the nonzero seed it drew, keeps the field at 0, and gives the same chart again for the shown seed. `ENSOMI_PLAYER=1` measures note geometry against `HTMLAudioElement.currentTime`, frame cadence, rates, and seeks on the final Adventure result. The memory sampler observes process RSS, not GPU allocation bytes.

`diagnostics.mts` starts an isolated server on an automatically allocated loopback port and bundles the production runtime into a test worker. `networks` runs one recorded call of each graph with verbose ORT logs and GPU profiling. `compare` runs every graph call in one Catch the Moment generation on WebGPU and WASM using identical feeds and aggregates absolute output differences. `replay` uses browser PCM and Python's recorded draws through `options.replay`; the core stops at the first draw whose name or choice differs from the recording, and the result reports that draw. The Wasm build has no trace hook, so grid positions are not compared. `control` repeats replay with the recorded Python PCM as a positive control: every hit object equal and every draw consumed. `pcm` compares native-rate and Mel PCM windows against the recordings to distinguish codec, resampling, and length changes.

`speed.sh <label> [repeats] [providers] [songs] [source]` builds the page, serves it on port 8087 with the release model and runs `page-matrix.mjs` once per song and provider (each song first in its session, so cold then warm), keeping every report under `artifacts/speed/runs/`; `speed-summary.mjs` prints load, wall and receipt phase seconds with the chart hash from such reports. `tests/browser/speed.sh after 2 "webgpu wasm" "adventure catch-the-moment"` is the inner loop; `hf` as the source times cold downloads from Hugging Face. `tests/browser/build-main.sh [commit]` builds the page with the TypeScript runtime (main `9d8e725`) into `artifacts/bulk/main`; `ENSOMI_SITE=artifacts/bulk/main/site tests/browser/speed.sh old ...` times that build on the same port.

`grid-drift.mjs <label>` generates the four release songs through the served page (WebAssembly, seed 1) and compares each receipt's timing segments and beat grid with the Python release receipts in `ensomi-model/artifacts/runtime-ref`; `ENSOMI_TEST_URL` points it at another build, such as main's on port 8088. `tail-screenshot.mjs <name>` replays wheel.mjs's Adventure result into the page and saves the inspector at its default speed around the long note closest before the next head in its lane, as `docs/screenshots/inspector-tail-<name>.png`.

`load-benchmark.mjs` serves the production page on an automatically allocated loopback port with a test-only worker bundle that times file reads and `InferenceSession.create`. It preserves the production caching and loading code. Its generated instrumented bundle lives only under artifacts. `fallback.mjs` injects missing-adapter and device-failure conditions into an isolated worker response. `wheel.mjs` replays a previously generated Adventure result into the actual page UI to isolate wheel event delivery from inference. `mobile.mjs` uses Chrome device emulation, not a real iOS/Android browser. `hero-contrast.mjs` and `hero-contrast.py` additionally compare the actual SVG backdrop behind solid text pixels; computed ancestor backgrounds alone miss this overlap. The extended player fixture run exercises all three rates for 60 seconds each. `validate-downloads.py` independently checks ZIP CRCs and parses exported hit objects. `../../artifacts/browser-test/report.md` is written from these runs.
