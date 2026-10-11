# Browser generation speed, 2026-10-11

Chrome on an Apple M5 (bings-mac), Adventure (3:20, 2,271 objects), local model, headless, seconds. Shipped in PR #4.

| Path | Version | Cache | Wall | Spectrogram | BeatThis | Mel | Grid | Rows | R2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WebGPU | before | warm | 21.86 | 1.41 | 1.54 | 1.97 | 0.34 | 1.36 | 15.10 |
| WebGPU | after | warm | 5.56 | 0.24 | 1.77 | 0.07 | 0.37 | 0.26 | 2.75 |
| WASM | before | warm | 27.33 | 1.30 | 19.68 | 1.83 | 0.32 | 0.40 | 3.65 |
| WASM | after | warm | 11.95 | 0.20 | 7.38 | 0.63 | 0.33 | 0.24 | 3.08 |

After the change the Log-Mel spectrogram runs while BeatThis waits on the GPU, so the WebGPU row's Mel time is only what is left after BeatThis. Catch the Moment after, warm: WebGPU 2.95, WASM 7.52. Cold from Hugging Face: model load 14-17 s before, 8-9 s after, because the 14 filter and state files now download in parallel; Adventure's cold first chart went from about 55 s to about 14 s. Run-to-run spread is about ±5%.

What each change gave:
- **Provider per graph:** only BeatThis on WebGPU. R2 15.1 → 3.8 s, rows 1.35 → 0.45 s. The rows encoder on WebGPU was slower.
- **Per-call work:** supports and lane masks computed once per held pattern, no per-head allocations. Rows .43 → .25 s, R2 2.87 → 2.60 s. ORT's own JS costs about .03 ms per call.
- **Threads:** cross-origin isolation (COOP `same-origin`, COEP `credentialless`). ORT Web has one thread pool, so the count is per page: 2 next to WebGPU (6.2-6.6 s against 7.4 s on one), 4 without it (12.7-13.1 s against 15.4-15.8 s on two). Safari ignores `credentialless` and stays on one thread.
- **Front end:** an iterative real FFT, bit-identical to the old one, and flat Mel weights. Spectrogram 1.41 → .20 s, Mel 1.97 → .62 s.
- **Fallback:** a failed WebGPU load retries on WebAssembly (`fallback.mjs`: device failure and missing adapter both end ready on WebAssembly).

Checks on the shipped code: seed-0 charts identical before and after on both paths (Adventure `0be1088d66819927`, Catch the Moment `b0bd781bf8f439e7`); `npm run parity` passes on all four songs; `diagnostics.mts wasm control` reproduces every hit object and consumes every draw on all four songs; `typecheck` and `typecheck:site` pass.

Next floor: `r2_commit`, about 2,800 calls at .76 ms, 2.1 of R2's 2.75 s. A ring-buffer state in the exported graph is estimated at .4-.6 s; fusing predict and commit at about .1 s.
