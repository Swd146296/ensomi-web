# Ensomi headed browser checks

Run from `packages/runtime` with Homebrew Node on PATH. These tests do not edit product code. They create evidence in `artifacts/browser-test/`; binaries, downloads, per-frame data, and large logs are confined to its `bulk/` directory.

```sh
export PATH=/opt/homebrew/bin:$PATH
npm run build:site
npm run typecheck:site
npm run serve:site -- 8087 ../../../ensomi-model/artifacts/release-r2/bulk/hf/ensomi-r2
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
node tests/browser/load-benchmark.mjs
python3 tests/browser/validate-downloads.py
python3 tests/browser/report.py
```

Prerequisites: installed package dependencies, installed Google Chrome, the sibling `ensomi-model` repository with release model, four dataset songs, and runtime-reference recordings. `ENSOMI_MODEL_DIR` and `ENSOMI_TEST_URL` override the page test's model directory and URL. Keep timing runs sequential.

`page-matrix.mjs` uses the actual built page, file/directory inputs, and both download links. It observes worker messages without changing computation. Cold means a fresh browser context with an empty Cache API; warm means a reload of that context after all model assets have been used. An optional fourth argument selects one song, allowing Adventure to be the first generation in its session. `ENSOMI_PLAYER=1` measures note geometry against `HTMLAudioElement.currentTime`, frame cadence, rates, and seeks on the final Adventure result. The memory sampler observes process RSS, not GPU allocation bytes.

`diagnostics.mts` starts an isolated server on an automatically allocated loopback port and bundles the production runtime into a test worker. `networks` runs one recorded call of each graph with verbose ORT logs and GPU profiling. `compare` runs every graph call in one Catch the Moment generation on WebGPU and WASM using identical feeds and aggregates absolute output differences. `replay` uses browser PCM and Python's recorded draws through the runtime's public hooks; it reports grid differences and the first draw-sequence failure without replacing choices. `control` repeats replay with the recorded Python PCM as a positive control. `pcm` compares native-rate and Mel PCM windows against the recordings to distinguish codec, resampling, and length changes.

`load-benchmark.mjs` serves the production page on an automatically allocated loopback port with a test-only worker bundle that times file reads and `InferenceSession.create`. It preserves the production caching and loading code. Its generated instrumented bundle lives only under artifacts. `fallback.mjs` injects missing-adapter and device-failure conditions into an isolated worker response. `wheel.mjs` replays a previously generated Adventure result into the actual page UI to isolate wheel event delivery from inference. `mobile.mjs` uses Chrome device emulation, not a real iOS/Android browser. `hero-contrast.mjs` and `hero-contrast.py` additionally compare the actual SVG backdrop behind solid text pixels; computed ancestor backgrounds alone miss this overlap. The extended player fixture run exercises all three rates for 60 seconds each. `validate-downloads.py` independently checks ZIP CRCs and parses exported hit objects. `report.py` assembles the complete evidence set and verifies product-source hashes.
