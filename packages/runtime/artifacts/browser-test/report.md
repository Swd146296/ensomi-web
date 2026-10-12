# Ensomi R2 browser tests

## Runtime 0.2.0, 2026-10-12, bings-mac

**The page generates with `@ensomi/runtime` 0.2.0, which arranges a song once. Its page code is unchanged: the receipt fields it reads are all still there. A whole-song generation through the page with Exact timing on gives the native runtime 0.2.0's chart for the same PCM, seed and request on all four release songs: the `.osu` is byte-identical on WebAssembly, and on WebGPU too except for one Catch the Moment beat length 1.1e-13 ms apart. The headless suite passes.**

**Package.** `npm install @ensomi/runtime@0.2.0 --save-exact` (job `20261012-140607-web020-install`): the lockfile's integrity is `sha512-yYZj6oTR…`, and the package's `src/` and `resampler/` equal `js/` of ensomi-runtime at tag `v0.2.0`. `index.d.ts` only gained the streaming API (`prepare`, `Prepared`, `ChartScheduler`), which the page does not use. In receipts `controls.difficulty.passes` has one entry, and `would_repass` and `commit` are gone; the page reads neither. `checks/same-as-ts.mjs` is removed: it compared with main `9d8e725`'s TypeScript runtime, which arranged a song a second time when the first arrangement missed the star's target, so their charts now differ by design.

**Same chart as native.** Job `20261012-140834-web020-equal`, comparison rerun in `20261012-141157-web020-compare2`. The page was built from this tree and served with the local model, in headless Chrome on WebAssembly and on WebGPU, with Exact timing on and seed 1, at the page matrix's stars. For each song the test kept the mono PCM at the file's rate that `site/app.ts` posts to the worker (copied before the transfer), the request, and the page's `.osu` download. `generate` (`crates/generate-ort/src/bin/generate.rs`, ensomi-runtime `v0.2.0`, ONNX Runtime CPU) then ran on the same PCM with the same rate, star, seed, title and audio file name. Without controls the page sends `controls: {sections: []}` and `generate` sends `long_notes: 0`, which the core reads alike. Exact timing is the page path whose input the native API takes: mono PCM at the file's rate. The default path passes WebAudio's 24000 and 22050 Hz streams, which `generate` cannot take.

| Song | Rate, Hz | Objects | WebAssembly | WebGPU |
| --- | --- | --- | --- | --- |
| Hesitation Snow | 48000 | 1,187 | `.osu` identical | `.osu` identical |
| SaiGetsu | 44100 | 1,168 | `.osu` identical | `.osu` identical |
| Catch the Moment | 44100 | 1,002 | `.osu` identical | hit objects identical; one of 3 timing points 1.1e-13 ms off |
| Adventure | 96000 | 2,284 | `.osu` identical | `.osu` identical |

Both builds write the same generator line, `// ensomi-runtime 0.2.0 seed=1 random=mulberry32-u53-v1`, and the page's chart objects equal those of the native `.osu`. The WebGPU difference is in the last printed digit of a beat length (631.3408359630795 against …794), from BeatThis on the GPU; ensomi-runtime's replay criteria allow timing points within 1e-6 ms. Against `@ensomi/runtime` 0.1.1 (`page-webgpu-local-exact.json`, same songs, stars and seed, Exact timing on), the chart hashes of Hesitation Snow, SaiGetsu and Catch the Moment are unchanged. 0.1.1 arranged those once. Adventure, which 0.1.1 arranged twice, went from 2,380 to 2,284 objects (job `20261012-143339-web020-hashes`).

**Checks.** Job `20261012-141212-web020-suite`, headless, every step exited 0: `npm ls` (0.2.0), `typecheck`, `typecheck:site`, `build:site` (`public/ensomi-runtime.wasm` is the package's core, SHA-256 `2d29a1f6…`).
- **Page matrix.** `page-matrix.mjs webgpu local` and, with `ENSOMI_PLAYER=1`, `wasm local` ran 9 generations each, `webgpu folder` 4, and `webgpu hf` 6, which loaded in 35 s on the first try. Every chart is valid with exact `.osz` contents and has one arrangement pass in its receipt. On each song the seed-1 chart is the same across both providers and all three sources. The seed-0 pair gives the same chart again, and the five-second section is rejected.
- **Player.** 60 fps at all three rates with zero drift; seeks are within 0.001 ms, and the volume checks pass.
- **Diagnostics.** `diagnostics.mts`:
  - `networks`: within 9.3e-5 of the recordings on WebGPU and WebAssembly.
  - `webgpu compare`: largest output difference 1.9e-4 (BeatThis).
  - The replay modes leave out the release's pass-2 draws, and on SaiGetsu and Catch the Moment, which the release arranged twice, they compare with the chart its pass-1 decisions make, as ensomi-runtime's `js/checks/replay.mjs` does. These were rerun after that change in job `20261012-143825-web020-replay-first`, after `typecheck` and `typecheck:site`.
  - `wasm control` and `wasm native`: every draw consumed and every hit object equal on the four songs. Hesitation Snow has 1,214 objects from 2,172 draws, SaiGetsu 1,131 from 1,805, Catch the Moment 1,126 from 1,767 and Adventure 2,557 from 3,850: 6,028 objects in all.
  - `wasm replay`: Hesitation Snow, Catch the Moment and Adventure stop at a rows draw (4, 1 and 15). SaiGetsu consumes every draw, and its objects differ from the first one on.
- **Downloads and grid.** `validate-downloads.py`: 67 archives, the 28 of this page matrix among them, no failures. `grid-drift.mjs npm` gives segments equal to `grid-drift-preview.json` and `grid-drift-exact-off.json` on every song, since the timing stages did not change.
- **`checks/ln-gaps.mjs`.** `artifacts/ln-gaps.json` was regenerated. No tail of the 3,479 generated long notes followed by a head in their lane ends at or after that head. Gaps under the head height: 205 at 120 px/s, 22 at 240 and 4 at 480, none at 720 (the default) or 960. The tail cap reaches into the next head 129 times at 120 px/s and 5 at 240 with the tail at its end time, and 69 and 4 when drawn short, none at 480 or faster. The shortest gaps are 26, 27, 27, 29 and 39 ms. With 0.1.0 ("Long-note tails" below) there were 3,139 such long notes, none under the head height at 480 px/s or faster, and a shortest gap of 39 ms; the charts differ where 0.1.0 arranged a song twice.

Other agents' builds ran on the mac during these jobs, so no timings are reported.

## Exact timing option, 2026-10-12, bings-mac

**The page has an Exact timing option, off by default, below the star rating and seed. Off, the page decodes and generates as before: the seed-1 charts are those of the deployed page, and the beat grid is up to 1.32 ms from the Python release (Catch the Moment). On, the page decodes the song again at the file's own sample rate and the core converts the rate as the Python release does: the beat grid is within 0.0032 ms of the release on the four songs, and Python's recorded draws reproduce all four release charts. With `@ensomi/runtime` 0.1.1 the option costs about 0.35 s on Catch the Moment (44.1 kHz, 2:01) and 1.3 s on Adventure (96 kHz, 3:19), warm on WebGPU. The suite passes headless.**

**The option.** A checkbox, `#exact` in `public/index.html`, unchecked in the markup and nowhere else; the note beside it reads: "Decodes the song at its own sample rate and converts it as the Python release does, so beat times match the release to within a few thousandths of a millisecond instead of up to about 1.3 ms. Adds about half a second per song, more for high-sample-rate files (about 1.3 s at 96 kHz)." The page reads it when Generate is pressed, so it applies per generation. Off is `main`'s path: `decodeAudio` at 24000 and 22050 Hz when the song is chosen and both streams to `generateChart`, with `pcm` 0.000 s in every generation. On, `site/audio.ts` (from `a119195` on `web/play-fixes`) reads the rate from the file's header and decodes the song once more at that rate, and the worker passes the mono PCM to `generateChart`, which converts it with the soxr table for that rate (BeatThis) and linear interpolation (Log-Mel). The build copies the package's 27 tables to `public/resampler/` (13.6 MB); the worker passes them as `runtimeSource`, and the core fetches the three for the song's rate only for exact timing (22050 Hz needs none; a rate without a table goes through the core's sinc resampler). With the option on, the receipt list adds `Timing: exact, from 44100 Hz` (the file's rate) and the times table `Exact-timing decode`. The runtime is 0.1.1 (its `src/` equal to `js/src/` at tag `v0.1.1`), whose converter no longer wraps a 32-bit index after 304 s of a 96 kHz song.

**Timing against the Python release.** `grid-drift.mjs` (headless Chrome, WebAssembly, seed 1, the original audio files), with the option off (`exact-off`) and on (`ENSOMI_EXACT=1`, `exact-on`):

| Song | File rate, Hz | off: max / median, ms | on: max / median, ms |
| --- | --- | --- | --- |
| Hesitation Snow | 48000 | 0.106 / 0.106 | 0.0003 / 0.0003 |
| SaiGetsu | 44100 | 0.040 / 0.040 | 0.0031 / 0.0031 |
| Catch the Moment | 44100 | 1.323 / 0.225 | 0.0015 / 0.0001 |
| Adventure | 96000 | 0.055 / 0.055 | 0.0000005 / 0.0000005 |

Off gives the segments of `main`'s preview build (`grid-drift-preview.json`) to every digit, and on those of `web/play-fixes` with runtime 0.1.0 (`grid-drift-npm.json`). SaiGetsu's 0.0031 ms comes from WebAudio's MP3 decoder, which clips at 1.0 where Python keeps 1.14 (`web/play-fixes` section), not from the conversion. `diagnostics.mts wasm native` replays Python's recorded draws on the page's exact-timing decoding of the original files: all four songs consume every draw and reproduce every hit object, 6,178 together.

**Cost.** `tests/browser/pcm-timing.sh` (job `20261012-081256-exact-timing`): three rounds in which each song gets, with the option off and then on, a reload (warm cache) and two generations, seed 1, WebGPU, local model, no other job on the mac (1-minute load average 2.5 to 2.7). The second decode runs in the page before the worker starts; `pcm` is the receipt's conversion stage.

| Song | File | off: total, s | on: second decode, s | on: `pcm`, s | on: total, s |
| --- | --- | --- | --- | --- | --- |
| Adventure | 96 kHz, 3:19 | 3.70–4.32 | 0.52–0.54 | 0.78–0.83 (2.22 first) | 6.04–7.01 (8.92 first) |
| Catch the Moment | 44.1 kHz, 2:01 | 2.17–2.48 | 0.15–0.17 | 0.19–0.21 | 2.31–2.42 |

The option's own cost is the second decode plus `pcm`: 0.35 to 0.36 s on Catch the Moment and 1.30 to 1.36 s on Adventure (2.75 s the first time); in the page matrix it was 0.48 s on Hesitation Snow (48 kHz, 2:45) and 0.35 s on SaiGetsu (44.1 kHz, 2:13). The first exact generation in a browser session spent longer in `pcm`: 2.22 s on Adventure here and 0.58 s on Catch the Moment in the page matrix. Runtime 0.1.0 spent 3.06 to 3.21 s in `pcm` on Adventure and 0.83 to 0.88 s on Catch the Moment in the same measurement on `web/play-fixes`. The option also changes the chart a seed gives, since the model sees different PCM, and the arrangement stage's time follows the chart: Adventure's seed-1 chart with the option on took 2.98 to 4.21 s to arrange against 1.46 to 2.02 s off, most of the gap between its totals, while in the page matrix Hesitation Snow's took 0.81 s against 1.66 s and SaiGetsu's 0.73 s against 1.50 s. With seeds 1 to 5 on Adventure, one warm page per setting (job `20261012-085521-exact-seeds2`), the arrangement took 1.46 s for seed 1 and 2.91 to 3.51 s for seeds 2 to 5 with the option off, and 3.08 to 3.38 s with it on; the totals of seeds 2 to 5 were 5.12 to 5.68 s off and 6.27 to 6.61 s on, about `pcm` (0.77 to 0.84 s) apart. Seed 1's chart without the option is a quick one to arrange. `pcm-timing.json` also records the wall time from Node's click call to the result; for the second generation in a page it includes up to about 1 s before the page receives the click, with the option off or on (page-side timestamps, job `20261012-081616-exact-probe`), so the costs above are read from the page's times table and receipt.

**Checks.** Job `20261012-080031-exact-suite`, headless, local model, every step exited 0: `npm ls` (0.1.1), `typecheck`, `typecheck:site`, `build:site` (27 tables in `public/resampler/`), `page-matrix.mjs webgpu local` and, with `ENSOMI_PLAYER=1`, `wasm local` with the option at its default (off at every load, read from the control; 9 generations each, every chart valid with exact `.osz` contents, decoded at 24000 and 22050 Hz, `pcm` 0.000 s and no Timing row; the seed-1 charts equal on both providers and to those the deployed page gave in job `20261012-075204` (`page-matrix.mjs webgpu folder` against https://ensomi.app); the seed-0 pair and the rejected five-second section as before; playback and volume checks passed), `ENSOMI_EXACT=1 page-matrix.mjs webgpu local` (the same 9 generations with the option on: every chart valid with exact `.osz` contents, a third decode at the file's rate, 44100, 48000 or 96000 Hz, `pcm` 0.19 to 0.74 s, the Timing row shown, and the seed drawn for seed 0 gave the same chart again), `grid-drift.mjs exact-off` and `exact-on`, `mobile.mjs` (no horizontal scroll from 360 to 1440 px, smallest contrast 6.7), `links.mjs` (8 links, all reachable), `validate-downloads.py` (63 archives, no failures) and `diagnostics.mts wasm native`. The note's figures went into `public/index.html` after this job; the page is otherwise the one it tested.

## Page fixes and the npm runtime, preview build, 2026-10-12, bings-mac

**Seed 0 draws a random seed, visual speeds are 240 to 960 px/s (720 by default), long-note tails are drawn 10 ms short, and the runtime comes from npm (`@ensomi/runtime` 0.1.0). The page still decodes each song with WebAudio at 24000 and 22050 Hz, so it keeps the Wasm build's beat-grid drift against the Python release: at most 1.32 ms, on Catch the Moment, and 0.04 to 0.11 ms on the other songs. Typecheck, build, the local page matrix on both providers, the player checks, grid drift, mobile, links and the downloads pass headless.**

**Decoding.** Decoding at the file's own rate and letting the core convert it, as the Python release does, takes the drift to 0.0015 ms, but the conversion (receipt stage `pcm`) takes 3.06 to 3.21 s of Adventure's (96 kHz) 8.3 to 8.5 s warm WebGPU generation and 0.83 to 0.88 s of Catch the Moment's (44.1 kHz) 3.0 to 3.2 s, and runtime 0.1.0's converter wraps a 32-bit index on wasm32, so the BeatThis stream goes wrong after 304 s of a 96 kHz song. The page is a live preview, where speed counts for more than a millisecond of timing, so that change (`a119195`) stays on `web/play-fixes`, whose report section has the measurements. Here the page passes both WebAudio streams to `generateChart`, which in 0.1.0 reads the resampler tables only for PCM without a BeatThis stream; the build copies none, and `pcm` is 0.00 s in every generation of the page matrix (Adventure warm: 3.70 s in total on WebGPU, 10.46 s on WebAssembly, one run each, not paired with the timings above). `grid-drift.mjs preview` (headless Chrome, WebAssembly, seed 1, the original audio files) gives the segments of `23fd8ba` to every digit:

| Song | File rate, Hz | this build: max / median, ms | runtime/wasm `23fd8ba` | native-rate decoding, `web/play-fixes` |
| --- | --- | --- | --- | --- |
| Hesitation Snow | 48000 | 0.106 / 0.106 | 0.106 / 0.106 | 0.0003 / 0.0003 |
| SaiGetsu | 44100 | 0.040 / 0.040 | 0.040 / 0.040 | 0.0031 / 0.0031 |
| Catch the Moment | 44100 | 1.323 / 0.225 | 1.323 / 0.225 | 0.0015 / 0.0001 |
| Adventure | 96000 | 0.055 / 0.055 | 0.055 / 0.055 | 0.0000005 / 0.0000005 |

Segment counts match the Python receipts. Catch the Moment's middle segment starts 1.260 ms early and 29 of its 201 beats are more than 1 ms off. `diagnostics.mts wasm replay`, Python's recorded draws on this decoding, stops at the same draws as before (`rows/4`, `r2_pass_2/677`, `rows/1`, `rows/15`).

**Long-note tails.** No client checked shortens the drawn tail by a time. osu!lazer places the tail at the end time and extends the body under head and tail (`HoldNote.cs`, `DrawableHoldNote.cs`); osu!stable's skin.ini has no tail offset; Quaver runs the body to the end object's middle and hides the end cap by default (`DrawLongNoteEnd`); Etterna's noteskins stop the body short of the tail by a pixel metric, `StopDrawingHoldBodyOffsetFromTail` (−32 px for 64 px notes in `common` and `kb7`, −16 in `retrobar-razor`, +4 in `beat`, 0 in `dance` and `popn`), which tucks the body under the tail note rather than leaving a gap before the next one. An open osu! pull request (ppy/osu#27726) proposes a tail-origin skin setting for tails that reach into the next note. `checks/ln-gaps.mjs` measured the charts the runtime generates for the four songs (recorded PCM, seeds 0 to 4) and the four Python release charts: of the 3,139 generated and 224 release long notes followed by a head in their lane, none ends at or after that head. Gaps shorter than the 14 px head occur only at the slow speeds: 188 generated and 11 release gaps at 120 px/s (the slowest speed before this branch; under 116.7 ms), 6 generated and no release gaps at 240 px/s (under 58.3 ms), none at 480 px/s or faster. The shortest are 39 ms (Catch the Moment seed 1, Adventure seed 4) and, in the release charts, 59 ms (Adventure). The inspector drew a 6 px tail cap and a 14 px head, each centred on its time, so the cap reaches into the next head when their centres are under 10 px apart: 113 generated and 10 release tails at 120 px/s and 3 generated at 240 px/s with the tail at its end time, none faster; drawn 10 ms short, 46 and 5 at 120 px/s and none at 240 px/s or faster (`artifacts/ln-gaps.json`). The overlaps the human saw are this geometry at the slow speeds, not a generator error. The inspector now draws the tail and the end of the body at `max(start, end − 10 ms)` (`tailTime` in `site/player.ts`); judgement, the chart and the `.osu` keep the end time. Screenshots at 720 px/s: `docs/screenshots/inspector-tail-before.png`, `inspector-tail-after.png`.

**Seed and speeds.** A seed of 0 draws a nonzero 32-bit seed per generation; the receipt list shows it marked as drawn at random, as do the identity line and the download names. The page matrix generated Catch the Moment with seed 0 and then with the seed the page showed: WebGPU drew 3568960606 and WebAssembly 3628096164, the receipt list showed each as `… (drawn at random)`, the seed field stayed at 0, and the shown seed gave the same chart (equal SHA-256 of the chart). The speed presets are 240, 480, 720 and 960 px/s with 720 selected; the player checks read the selected speed.

**Volume.** A volume slider beside the audio rate, 0 to 100% in steps of 5 and 80% by default, sets the audio element's volume to its value over 100, so playback is never louder than the file and the chart, downloads and `.osz` do not change; in job `20261012-073843-volume-suite` (headless, local model; `typecheck`, `typecheck:site`, `build:site`, `ENSOMI_PLAYER=1 page-matrix.mjs wasm local` and `mobile.mjs` all exited 0) the element was at 0.8 before the first play, 0.75 after one Left arrow, 0.4 after a click at 40% of the slider and 1 after End and three Right arrows.

**npm runtime.** The tarball of `@ensomi/runtime` 0.1.0 on registry.npmjs.org has the lockfile's integrity (`sha512-wKwqTsRC…`), and its `src/` equals `js/src/` at tag `v0.1.0` of ensomi-labs/runtime. `npm run same-as-ts` read package 0.1.0 and found all 13 cases equal to main's TypeScript runtime (chart, `.osu` and receipt; job `20261012-054030-node-checks` on the tree of `6f304b6`, whose checks, lockfile and `site/player.ts` this branch has unchanged; the check runs no page code).

**Checks.** Job `20261012-065552-preview-suite`, headless, local model, every step exited 0: `npm ls` (0.1.0), `typecheck`, `typecheck:site`, `build:site` (no `public/resampler/`), `page-matrix.mjs webgpu local` and, with `ENSOMI_PLAYER=1`, `wasm local` (9 generations each including the seed-0 pair, every chart valid with exact `.osz` contents and decoded at 24000 and 22050 Hz, the same seed-1 charts on both providers, the five-second section rejected; playback at 60 fps on all three rates with zero drift, arrow, click, drag, wheel and overview seeks within 0.001 ms), `grid-drift.mjs preview`, `mobile.mjs` (no horizontal scroll from 360 to 1440 px, smallest contrast 6.7), `links.mjs` (8 links, all 200), `validate-downloads.py` (the 34 `.osz` of these runs and 20 older ones from earlier `hf` and `folder` runs, no failures) and `diagnostics.mts wasm replay`. The rest of the suite (`hf` and `folder` sources, the other diagnostics, fallback, wheel, contrast, load benchmark, tail screenshots) passed on `web/play-fixes` (its three `hf` loads that timed out on the mac's network on a second run), whose page differs from this one only in its decoding, and was not repeated.

## Wasm runtime after the core speed fixes, 2026-10-12, bings-mac

**The page now generates with ensomi-runtime `5840ea6` and is faster warm than main's TypeScript build on every song: new ÷ main 0.87 to 0.96 on WebGPU and 0.94 to 0.97 on WebAssembly (median of 5 or 6 back-to-back pairs per song and provider). Charts are identical to main's, `npm run same-as-ts` finds all 13 cases equal, and the browser suite passes. The renderer's peak memory is still 0.2 to 0.5 GiB higher.**

What changed in the core (causes in the section below):

- **Math.** `exp`, `log`, `log1p`, `log2`, `sin`, `cos`, `atan2` and `hypot` come from the `libm` crate on every target. The port of V8's `Math` with fused multiply-adds is gone, and with it the software `fma` in WebAssembly. Charts, `.osu` text and receipts are still equal to the TypeScript runtime's on all 13 `same-as-ts` cases (mean wall per chart in Node: TypeScript 22.6 s, Wasm 21.2 s), and replay parity with the Python release passes natively and in Wasm.
- **Overlap.** After the core asks for a BeatThis run, `generateChart` calls the core's `work()` until the outputs arrive; each call computes 64 Log-Mel frames. The Mel phase left after BeatThis is now 0.06 s on WebGPU, as in main.
- The carried R2 state is moved into the commit graph's inputs instead of copied, and the samples are not mixed down when both decoded streams are given.

**Old against new.** `tests/browser/old-vs-new.sh` in two sessions of three rounds (labels `libm` and `libm2`), procedure as below. Four runs failed to load the model because the page could not fetch ONNX Runtime's Wasm from the CDN (`Failed to fetch`, three of main's, one of the new page's); their pairs are left out. Other agents' Xcode builds ran throughout: the 1-minute load average before a run was 2.5 to 53.7, median 5.2, so single pairs range widely and the medians are the comparison.

| Song | Provider | Pairs | main warm, s | new warm, s | new / main | Pair range | main peak, GiB | new peak, GiB | Same chart |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Adventure | WebGPU | 6 | 5.97 | 5.51 | 0.87 | 0.63–1.11 | 3.57 | 3.79 | yes |
| Catch the Moment | WebGPU | 6 | 3.77 | 2.96 | 0.87 | 0.76–1.11 | 2.01 | 2.20 | yes |
| Hesitation Snow | WebGPU | 5 | 3.20 | 3.07 | 0.96 | 0.88–1.06 | 2.33 | 2.55 | yes |
| SaiGetsu | WebGPU | 5 | 2.67 | 2.77 | 0.96 | 0.90–1.22 | 2.06 | 2.25 | yes |
| Adventure | WebAssembly | 6 | 13.08 | 12.14 | 0.95 | 0.72–1.42 | 3.83 | 4.33 | yes |
| Catch the Moment | WebAssembly | 5 | 7.47 | 7.27 | 0.97 | 0.93–1.03 | 2.51 | 2.88 | yes |
| Hesitation Snow | WebAssembly | 5 | 9.09 | 8.44 | 0.97 | 0.84–1.06 | 2.80 | 3.07 | yes |
| SaiGetsu | WebAssembly | 6 | 7.10 | 7.09 | 0.94 | 0.88–1.09 | 2.61 | 2.92 | yes |

Receipt phase seconds, median over all warm runs of both sessions:

| Provider | Build | Spectrogram | BeatThis | Mel | Grid | Rows | Arrangement | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WebGPU | main | 0.18 | 1.55 | 0.06 | 0.26 | 0.25 | 1.46 | 3.71 |
| WebGPU | new | 0.14 | 1.50 | 0.06 | 0.17 | 0.17 | 1.31 | 2.99 |
| WebAssembly | main | 0.17 | 6.42 | 0.54 | 0.24 | 0.21 | 1.26 | 8.45 |
| WebAssembly | new | 0.13 | 6.49 | 0.40 | 0.12 | 0.10 | 1.34 | 8.16 |

The core's own phases are now faster than main's; arrangement, mostly ONNX Runtime's R2 calls, is about equal.

**Memory.** The new page still peaks higher. A Node probe of the two runtimes on Adventure with the page's input (decoded Mel and BeatThis streams, WASM backend, one thread) gives peak RSS 1,740 MiB against 1,558 MiB, ArrayBuffer bytes 359 MiB against 101 MiB, of which 119 MiB is the core's linear memory. WebAssembly memory keeps its high-water mark, and the core starts with three copies of the input streams (the samples, which the page passes as the Mel stream, the Mel stream and the BeatThis stream: 56 MB for Adventure). The rest is JavaScript copies of tensors crossing between the core and ONNX Runtime (the R2 state, 0.5 MB per head row, crosses both ways where main passed one output tensor back as the next input). Both are left as they are.

**Suite.** Every step of the suite above ran headless on the new build and exited 0: the page matrix (30 generations, all charts valid, no sampling fallbacks, the five-second section rejected; seed-0 hashes as below for all four songs on both providers and every source), player and wheel fixtures (60 fps, zero drift), `fallback.mjs`, `diagnostics.mts` (networks within 9.3e-5 of the recordings; `wasm control` equal on all 6,178 hit objects with every draw consumed; `wasm replay` stops at the same draws as before), mobile, contrast and link checks, all 50 `.osz` in `validate-downloads.py`, and `load-benchmark.mjs`. Cold loads today were slow for both builds while the CDN fetches were (median 26 s for main and 33 s for the new page on WebGPU in the timing runs), so this report makes no claim about load time.

## Wasm runtime (ensomi-runtime 7130c47), 2026-10-12, bings-mac

**The page generates with the Wasm build of ensomi-runtime (`packages/runtime`, vendored from `7130c47`) and its charts are identical to main's TypeScript build on WebGPU and WebAssembly. The browser suite passes. Warm generation is slower: 1.16 to 1.27 times main's on WebGPU and 1.05 to 1.09 times on WebAssembly, and the renderer's peak memory is 0.2 to 0.4 GiB higher. Build flags do not close the gap; it comes from the core.**

Environment: macOS 27, Apple M5 (4 performance and 6 efficiency cores), Chrome 154.0.8037.99 headless (`channel: 'chrome'`), Playwright 1.54.2, ONNX Runtime Web 1.23.2, WebGPU adapter `apple / metal-3` (available headless). Threads as on the site: WebAssembly on 4, next to WebGPU on 2. Local model served by `site/serve.mjs`. Other agents' builds and tests ran on the mac during part of these runs, so timings are compared in back-to-back pairs and the load average is recorded per run (1.0 to 5.3).

**Suite.** Every script in `tests/browser/README.md` ran headless on the new build and passed:

| Check | Result |
| --- | --- |
| `page-matrix.mjs` webgpu/wasm local, webgpu/wasm hf, webgpu folder | 30 generations, four songs per source; all charts valid, both downloads on every run, `.osz` audio, chart and receipt exact; the 20–25 s section rejected before sending; no sampling fallbacks |
| Seed-0 charts across providers and sources | one hash per song: Catch the Moment `b0bd781bf8f4` (894 objects), Adventure `0be1088d6681` (2,271), Hesitation Snow `d9172331dd61` (982), SaiGetsu `009f98d5c4f5` (1,213) |
| `ENSOMI_PLAYER=1` page-matrix and wheel fixture | 60 fps at 0.5×, 1× and 1.5×; zero geometry drift; seeks within 0.001 ms |
| `fallback.mjs` | missing adapter and injected device failure both end ready on WebAssembly (4 threads) |
| `diagnostics.mts webgpu networks` / `wasm networks` | every graph runs; largest difference from the recording 9.3e-5 (BeatThis) |
| `diagnostics.mts webgpu compare` | 2,712 paired WebGPU/WASM calls on Catch the Moment, largest difference 1.86e-4 (BeatThis), no nonfinite differences, 894 objects |
| `diagnostics.mts wasm control` | recorded Python PCM and draws: all 6,178 hit objects equal and every draw consumed on the four songs |
| `diagnostics.mts wasm replay` / `wasm pcm` | browser-decoded audio still diverges from Python at the same draws as on 2026-10-11 (`rows/4`, `r2_pass_2/677`, `rows/1`, `rows/15`); decoding is unchanged (D1) |
| `mobile.mjs`, `hero-contrast.mjs` + `.py`, `links.mjs` | no page-wide overflow; every text pair passes AA (lowest 6.7:1, hero 8.1:1); all eight links HTTP 200; the command example still scrolls inside its box (D5) |
| `validate-downloads.py` | all 42 `.osz` in `bulk/` pass CRC and chart checks |
| `load-benchmark.mjs` | loads complete; the core now reads all 120,376,131 model bytes at load, where the TypeScript runtime deferred 14 filter and state files to the first generation |

**Old against new.** The procedure of `tests/browser/old-vs-new.sh`, three rounds: for each song and provider, main's page (`tests/browser/build-main.sh`) and the new page back to back in fresh Chrome instances, order alternating, three rounds; each run is `page-matrix.mjs` with one song (cold, then warm after a reload). Seconds are medians of the three warm generations; the ratio is the median of the paired ratios; memory is the highest renderer RSS over the three runs.

| Song | Provider | main warm, s | new warm, s | new / main | main peak, GiB | new peak, GiB | Same chart |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Adventure | WebGPU | 5.80 | 7.34 | 1.27 | 3.76 | 3.97 | yes |
| Catch the Moment | WebGPU | 5.44 | 6.15 | 1.16 | 2.04 | 2.31 | yes |
| Hesitation Snow | WebGPU | 3.76 | 4.78 | 1.27 | 2.35 | 2.65 | yes |
| SaiGetsu | WebGPU | 3.54 | 4.17 | 1.25 | 2.05 | 2.34 | yes |
| Adventure | WebAssembly | 17.09 | 17.50 | 1.09 | 4.11 | 4.45 | yes |
| Catch the Moment | WebAssembly | 11.21 | 11.52 | 1.08 | 2.56 | 2.90 | yes |
| Hesitation Snow | WebAssembly | 11.07 | 12.09 | 1.09 | 2.80 | 3.17 | yes |
| SaiGetsu | WebAssembly | 9.60 | 9.66 | 1.05 | 2.59 | 2.94 | yes |

Absolute seconds carry the shared machine's load (on a quiet run main's Adventure took 5.3–5.4 s on WebGPU and 11.9–12.0 s on WebAssembly); the ratios are the comparison. Cold model load is unchanged (median 1.5 s WebGPU, 1.2 s WebAssembly, local model).

**Where the time goes.** Receipt phase seconds, median over all warm runs above:

| Provider | Build | Spectrogram | BeatThis | Mel | Grid | Rows | Arrangement | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WebGPU | main | 0.18 | 1.53 | 0.12 | 0.34 | 0.30 | 1.45 | 4.16 |
| WebGPU | new | 0.23 | 1.44 | 0.98 | 0.16 | 0.68 | 1.55 | 5.33 |
| WebAssembly | main | 0.16 | 8.52 | 0.58 | 0.21 | 0.20 | 1.40 | 11.33 |
| WebAssembly | new | 0.21 | 8.55 | 0.77 | 0.14 | 0.73 | 1.73 | 12.23 |

Two causes, both in the core:

- **Software fused multiply-add.** The core's port of V8's `Math` (`crates/generate/src/jsmath.rs`) uses `f64::mul_add` to reproduce Node-on-arm64's last bits. WebAssembly has no scalar FMA, so each call goes to compiler-builtins' software `fma`. A Node CPU profile of two charts (Catch the Moment and Adventure) puts 1.8 s in `fma` alone, under `jsmath::log`, `exp`, `log2` and `log1p`, called from figure sampling (`multinomial`), the Log-Mel `spectrogram`, R2 sampling (`gumbel`), `decode_rows` and `features`. This is the rows, Mel, spectrogram and arrangement increase on both providers; grid fitting is faster than TypeScript.
- **No overlap with BeatThis.** The TypeScript runtime computed the Log-Mel spectrogram while BeatThis ran on the GPU (#4). The core computes it after BeatThis returns. The Mel phase grows 0.86 s on WebGPU against 0.20 s on WebAssembly, where nothing overlapped before either.

**Build variants.** The same glue with other core builds, alternated with main's page; warm seconds for Adventure / Catch the Moment. Screen 1 is the mean of two rounds; screen 2 is one round (its second round ran under other agents' load and is left out).

| Build | WebGPU | WebAssembly | Screen |
| --- | --- | --- | --- |
| main (TypeScript) | 5.85 / 3.64 | 13.74 / 9.87 | 1 |
| plain (`scripts/wasm-build.sh`) | 7.90 / 4.97 | 15.83 / 11.61 | 1 |
| plain, `wasm-opt -O3` | 9.97 / 5.66 | 17.25 / 13.35 | 1 |
| `+simd128`, fat LTO, one codegen unit, `wasm-opt -O3` | 8.94 / 4.61 | 15.45 / 10.54 | 1 |
| main (TypeScript) | 5.42 / 3.32 | 12.03 / 8.92 | 2 |
| plain | 7.71 / 4.04 | 13.55 / 9.42 | 2 |
| `+simd128` | 7.71 / 4.10 | 13.71 / 9.59 | 2 |
| `+simd128`, fat LTO, one codegen unit | 9.65 / 4.51 | 15.00 / 10.97 | 2 |

None closes the gap, and `wasm-opt -O3` makes it wider, so the vendored build is the plain one that ensomi-runtime's `scripts/wasm-build.sh` makes.

**What it needs.** In ensomi-runtime: an exact FMA that is fast in WebAssembly (or `jsmath` paths that avoid it there), and a generator step that lets the caller run BeatThis while the core computes the Log-Mel spectrogram. Then `npm run vendor`, `npm run same-as-ts` and `tests/browser/old-vs-new.sh` again.

## TypeScript runtime baseline, 2026-10-11

**Ensomi R2 browser test — 2026-10-11, bings-mac.**

The generator works in headed Chrome on this Apple M5. All four songs pass the requested chart and download checks on WebGPU and forced WASM. Browser-decoded audio does **not** preserve Python replay parity; Catch the Moment exceeds a 1 ms grid-difference target. There are also a GPU-failure recovery defect, a mobile text-contrast failure, a broken runtime link, and horizontal scrolling inside the mobile command example. Product source was not changed.

Environment: macOS 27.0 (26A428), Apple M5, 24 GiB RAM, Chrome 154.0.8037.99, Playwright 1.54.2, ONNX Runtime Web 1.23.2. The first local WebGPU baseline used Chrome 154.0.8037.58 before Chrome updated; the subsequent .99 Hugging Face/folder runs reproduced its charts. Adapter: `apple / metal-3`; no software-GPU or WebGPU-enabling flags. Inference runs in the production Web Worker; WASM uses one thread. Mobile results are Chrome device emulation, not real Safari/Android-device tests.

`npm run build:site` and `npm run typecheck:site` passed. The product was served at `http://127.0.0.1:8087/` because 8080 was occupied. The mac has stale Git metadata (`astra-draft-init`), as expected for this synced workspace; no branch operation, commit, push, or deployment was performed. Tested source/bundle identities are in [source-hashes.json](source-hashes.json); [source-verification.json](source-verification.json) confirms the snapshot stayed unchanged. Generated bundles were rebuilt with the requested build command.

**1. WebGPU execution and numerical agreement.**

All six graphs execute GPU compute dispatches and all six also contain CPU/WASM placements. No real graph/session failure occurred on this Mac. The table combines ORT’s verbose optimized-node placement log, actual `GPUComputePassEncoder.dispatchWorkgroups` observations for one recorded invocation per graph, and a separate complete Catch the Moment generation that ran every graph call twice with identical inputs (WebGPU versus WASM). Placement counts include metadata and copy nodes; they are not shader counts.

| Graph | GPU / CPU nodes | GPU dispatches, one call | Paired calls, song | Maximum absolute output difference |

| --- | --- | --- | --- | --- |

| beatthis | 1469 / 614 | 965 | 5 | 0.000185966492 |

| rows_encoder | 159 / 89 | 131 | 1 | 1.3589859e-05 |

| rows_step | 44 / 3 | 32 | 200 | 1.52587891e-05 |

| r2_predict | 73 / 3 | 51 | 1228 | 1.33514404e-05 |

| r2_release | 50 / 11 | 44 | 52 | 0.000122070312 |

| r2_commit | 273 / 1 | 217 | 1226 | 5.96046448e-06 |



The largest WebGPU–WASM difference is **0.0001859665** in BeatThis, over **2,712 paired graph calls**. There were no unequal nonfinite outputs. Every WebGPU/WASM seed-0 hit object and chart duration is identical across the four songs. The largest timing-point value difference is **1.454754965e-7 ms**, below the agreed 1e-6 ms tolerance.

CPU placements: BeatThis has 614 nodes, predominantly int64 shape/index processing (`Gather`, `Unsqueeze`, `Concat`, integer arithmetic and slicing). Rows encoder has 89 shape, index, range and mask nodes. R2 commit’s `/Add_24` updates an int64 counter. R2 predict places `/Cast`, `/ReduceSum`, `/Greater` on CPU; release places 11 nodes from its int64 action/index/count branch on CPU. Rows step places `/gru/GRU`, `/Unsqueeze_2`, and `/LogSoftmax` on CPU; GRU and LogSoftmax are absent from the installed WebGPU operator registry. ORT explicitly logs that some shape-related CPU paths avoid GPU transfer overhead. [operator-placement.json](operator-placement.json) lists **every** placed node, operator, and available inferred dtype. Full logs and direct dispatch evidence are under `bulk/diagnostics-webgpu-networks-*`; full output-error aggregation is in [diagnostics-webgpu-compare.json](diagnostics-webgpu-compare.json).

A missing adapter correctly selects WASM. A separately injected `GPUAdapter.requestDevice` failure leaves the model unloaded with `Could not load the model: 9392000`; it does not retry WASM. This is fault-injection evidence, not a spontaneous failure of this Mac’s GPU. See defect D2 and [fallback.json](fallback.json).

**2. Functional checks.**

There were **34 successful page generations**: four songs through the local HTTP model, Hugging Face, and the directory-upload input (the `onnx/` subfolder), plus provider/cache/section repetitions. Both providers were exercised with local HTTP and Hugging Face; Directory-upload runs used WebGPU. Seed was 0 and stars were the release values below. Every run had integer milliseconds in range, lanes 0–3, start/lane ordering, no duplicate heads or overlapping holds, and all holds closed. Emergency sampling fallback count was zero.

| Song | Stars | Duration, s | Taps | Holds | Total objects | Rules / exports |

| --- | --- | --- | --- | --- | --- | --- |

| Hesitation Snow | 2.5 | 165.679 | 530 | 452 | 982 | PASS |

| SaiGetsu | 3.5 | 133.224 | 905 | 308 | 1213 | PASS |

| Catch the Moment | 3.5 | 121.169 | 675 | 219 | 894 | PASS |

| Adventure | 4.5 | 199.965 | 2044 | 227 | 2271 | PASS |



Both download links were clicked on every run. All **34 `.osz` files** contain `generated.osu`, the correct `audio.mp3` or `audio.ogg`, and `receipt.json`. Encoded audio is byte-identical to the uploaded file; the archived chart matches the direct `.osu` download and its parsed objects match the result chart. An independent Python ZIP reader verified all CRCs: **34/34 pass**. Evidence: [download-validation.json](download-validation.json), `page-*.json`, and the downloaded files in `bulk/`.

SaiGetsu’s requested **20–40 s jumpstream span at 0.7** was accepted on both providers, added bookmarks at 20000/40000 ms, and affected the chart. Its measured stream statistic was **0.734848** against target **0.747444**, with jump share **0.424242**; both were inside their calibrated bands. A **20–25 s** span displayed `Section 1: a section must last 8–32 seconds.` and disabled Generate before any request was sent. Screenshots: [accepted section](screenshots/webgpu-local-cold-saigetsu-section.png), [invalid section](screenshots/webgpu-invalid-section.png).

**3. Player and Beatmap Lens comparison.**

The instrumented production canvas was checked against `HTMLAudioElement.currentTime`. Note coordinates and the displayed clock were observed independently; the clock has 1 ms display precision. The extended run reused the exact previously generated Adventure chart and original audio to isolate rendering; an earlier freshly generated Adventure result also passed. Each rate was exercised for 60 seconds of wall playback at 240 px/s.

| Rate | Frames | FPS | p95 interval, ms | Max interval, ms | p95 draw CPU, ms | Max geometry drift, ms | Max clock-label drift, ms |

| --- | --- | --- | --- | --- | --- | --- | --- |

| 1 | 3601 | 59.999 | 17.40 | 17.90 | 0.80 | 0.000 | 0.500 |

| 0.5 | 3600 | 60.001 | 18.10 | 18.80 | 0.90 | 0.000 | 0.500 |

| 1.5 | 3600 | 60.001 | 18.10 | 18.80 | 0.90 | 0.000 | 0.500 |



There was no accumulated drift and no drift beyond one frame. This measures the browser audio clock and rendered geometry, not acoustic output latency or physical display scanout. Space play/pause, ±5 s keys, ±40 px Up/Down, click seek, drag scrub, wheel, overview seek, and restart passed. Seek errors were at most **0.001 ms** after settling. A macOS/Chrome input scaling detail is documented in [wheel.json](wheel.json): Playwright’s `wheel(0,120)` delivers `deltaY=240`, correctly moving 1000 ms at 240 px/s; a DOM event with `deltaY=120` moves 500 ms. This is not an application wheel defect. Evidence: [player-extended.json](player-extended.json), `bulk/player-*-frames.json`, [player screenshot](screenshots/player-adventure.png).

The named reference `beatmap-lens/apps/inspector/src/InspectWorkspace.vue` currently renders a static SVG preview. The live behavior was compared by source review with `FallingNoteViewport.vue`, `CompareWorkspace.vue`, and the annotation playback controllers; the reference app was not run. Ensomi matches the wheel/arrow direction and pixel-to-time conversion, separates visual speed from audio rate, uses an audio-clock playhead, and supplies a density overview. Gaps: Lens has selection playback/looping, audio offset and volume, and range selection with Shift-drag scrubbing; Ensomi’s plain drag scrubs and has no selection, loop, offset, volume, or arbitrary visual-speed field. These are feature gaps, not failures of the tested transport controls.

**4. Time to first chart.**

Seconds below are individual sequential observations. Cold means a fresh Chrome context with an empty Cache API; warm means a reload after generation populated the cache. OS filesystem, GPU-driver, and CDN-edge caches were not purged. Network timings vary between runs. The two songs are each the **first generation in their session** in this table. Total is model load + browser audio decode + observed Generate-click-to-result wall time, excluding human file-picking time. Decode is read from the page’s 0.01 s timing table; totals are consequently approximate.

| Song | Provider | Cache | Model load | Decode | Generation wall | First-chart total |

| --- | --- | --- | --- | --- | --- | --- |

| Catch the Moment | webgpu | cold | 20.70 | 0.20 | 27.08 | 47.98 |

| Catch the Moment | webgpu | warm | 0.77 | 0.22 | 10.72 | 11.71 |

| Catch the Moment | wasm | cold | 14.81 | 0.20 | 32.65 | 47.66 |

| Catch the Moment | wasm | warm | 0.47 | 0.20 | 18.07 | 18.74 |

| Adventure | webgpu | cold | 14.84 | 0.55 | 35.47 | 50.87 |

| Adventure | webgpu | warm | 0.77 | 0.56 | 21.87 | 23.19 |

| Adventure | wasm | cold | 15.92 | 0.53 | 40.49 | 56.94 |

| Adventure | wasm | warm | 0.45 | 0.50 | 26.97 | 27.93 |



Per-phase receipt timings (s) follow. Cold first-generation frontend and R2 times include deferred downloads of Mel filters and initial-state arrays; they are not pure compute measurements. Receipt generation totals exclude some validation, ZIP packaging and message delivery, so the wall column above is slightly larger.

Catch the Moment:

| Provider / cache | PCM | Spectrogram | BeatThis | Mel | Grid | Rows | Prior | R2 | Export |

| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

| webgpu / cold | 0.000 | 2.946 | 1.114 | 3.710 | 0.145 | 0.642 | 0.002 | 18.409 | 0.001 |

| webgpu / warm | 0.000 | 0.896 | 1.124 | 1.201 | 0.154 | 0.646 | 0.001 | 6.590 | 0.001 |

| wasm / cold | 0.000 | 2.724 | 13.881 | 2.994 | 0.142 | 0.206 | 0.001 | 12.592 | 0.001 |

| wasm / warm | 0.000 | 0.806 | 14.086 | 1.095 | 0.141 | 0.205 | 0.001 | 1.636 | 0.001 |



Adventure:

| Provider / cache | PCM | Spectrogram | BeatThis | Mel | Grid | Rows | Prior | R2 | Export |

| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

| webgpu / cold | 0.000 | 3.591 | 1.589 | 3.814 | 0.327 | 1.344 | 0.002 | 24.663 | 0.001 |

| webgpu / warm | 0.000 | 1.442 | 1.593 | 2.022 | 0.324 | 1.356 | 0.002 | 14.978 | 0.001 |

| wasm / cold | 0.000 | 3.220 | 19.389 | 3.634 | 0.319 | 0.391 | 0.002 | 13.393 | 0.001 |

| wasm / warm | 0.000 | 1.294 | 19.398 | 1.784 | 0.319 | 0.398 | 0.002 | 3.636 | 0.001 |



An additional test-only worker build timed the production file-reading and session-creation calls separately. It loaded **110,884,603 bytes** (runtime manifest plus six graphs). File read time includes transfer/cache reads and cache writes. Session initialization includes ORT bootstrap/WASM fetching; ORT module import was 0.002–0.003 s. The remaining small difference is manifest parsing and orchestration. These independent load measurements should not be substituted into the first-chart samples above.

| Source | Provider | Cache | File reads / download, s | Graph initialization, s | Total load, s |

| --- | --- | --- | --- | --- | --- |

| local | webgpu | cold | 0.227 | 1.365 | 1.607 |

| local | webgpu | warm | 0.022 | 0.737 | 0.773 |

| local | wasm | cold | 0.201 | 0.952 | 1.165 |

| local | wasm | warm | 0.020 | 0.429 | 0.460 |

| hf | webgpu | cold | 14.435 | 1.476 | 15.931 |

| hf | webgpu | warm | 0.023 | 0.690 | 0.728 |

| hf | wasm | cold | 13.748 | 0.977 | 14.745 |

| hf | wasm | warm | 0.021 | 0.410 | 0.443 |



Warm load-only file reads were all Cache API hits. First generation reads 14 additional filter/state files (1,040,136 bytes), for 111,924,739 model bytes in total; these are cached on first use. See [load-benchmark.json](load-benchmark.json) for individual graph/read times and resource timings. Local compute baselines illustrate the tradeoff: Adventure’s BeatThis takes **1.58 s WebGPU / 19.62 s WASM**, while R2 takes **15.15 / 3.67 s**. Consider choosing providers per graph after fixing frontend parity.

Peak observed renderer RSS in the isolated Adventure cold/warm sessions: **2.83 GiB WebGPU**, **3.15 GiB WASM**; the four-song WASM session reached **3.31 GiB** in the RSS sampler. The page’s main-thread JS heap peaked around **118 MB**, which excludes much worker/WASM/GPU storage. RSS was sampled once per second and includes the whole renderer, retained test results, and decoded audio; GPU allocation peak was not available. Per-session memory fields are in `page-*.json` and the independent samples in `memory-*.json`.

**5. Browser decode against Python.**

The grid comparison evaluates the same 24 candidate head positions per beat as the existing runtime parity check, before whole-ms rounding. Counts and beat indexing matched on all four songs. Pairing differently generated final heads by ordinal would be misleading, so the table uses aligned grid positions instead. Runtime replay used the recorded random values without substituting recorded choices.

| Song | Candidate positions | Max grid difference, ms | Median, ms | Rounded positions changed | First sampled-choice divergence |

| --- | --- | --- | --- | --- | --- |

| Hesitation Snow | 8976 | 0.106141 | 0.106141 | 998 | rows/4/figure |

| SaiGetsu | 5472 | 0.040349 | 0.040349 | 268 | r2_pass_2/677/action |

| Catch the Moment | 4800 | 2.669289 | 1.211922 | 3236 | rows/1/figure |

| Adventure | 10248 | 0.054563 | 0.054563 | 535 | rows/15/figure |



None of the browser-PCM replays matches Python. SaiGetsu finishes with **1,203 objects versus 1,215**, and leaves two recorded draws unused; its rows have the same count but some head times differ by 1 ms. The other three change row/hold choices and then cannot consume the original linear draw sequence (the requested draw name no longer matches). Those runs are reported as divergent/aborted, not as completed charts. Full differences and stopping points: [diagnostics-wasm-replay.json](diagnostics-wasm-replay.json).

Positive control: the **same browser WASM runtime and replay harness**, given recorded Python native PCM plus its Mel PCM, reproduces **all 6,178 hit objects and 12,733 choices** exactly across the four songs, consuming every draw. This isolates the failed replay to the browser audio frontend rather than the replay implementation. Evidence: [diagnostics-wasm-control.json](diagnostics-wasm-control.json).

| Song | Native-rate frames difference | 24 kHz frames difference | Sampled native PCM max error | Sampled Mel PCM max error |

| --- | --- | --- | --- | --- |

| Hesitation Snow | 0 | -1 | 2.98023224e-07 | 0.314031 |

| SaiGetsu | 0 | -1 | 0.0706441402 | 0.182995 |

| Catch the Moment | 0 | 0 | 8.94069672e-07 | 0.361941 |

| Adventure | 0 | -1 | 3.57627869e-07 | 0.378881 |



PCM error samples cover four 2-second windows per song (0, 30, 60, 100 s), not every sample. Native-rate decoding has zero length difference and zero measured lag. Three songs agree within 9e-7 in the sampled native PCM. SaiGetsu has **decoder clipping**: at **30,813.696 ms**, a Python channel value **1.141288161** becomes **1.0** in Chrome, producing a 0.070644 mono difference. This also occurs at negative peaks.

The dominant frontend change is **resampling and amplitude preprocessing**: `src/decode_audio.ts` asks WebAudio to resample independently to 24,000 and 22,050 Hz and then normalizes the Mel stream. Python’s Mel loader uses pydub/ffmpeg, integer audio operations and `set_frame_rate`; BeatThis uses libsndfile plus the recorded torchaudio resampler. Native PCM is nearly identical for the other three songs, while sampled normalized Mel errors reach 0.18–0.38, supporting this attribution. Chrome’s resampled 24 kHz stream is one sample shorter on three songs (**0.041667 ms**); the song-duration difference is at most **0.031462 ms**. Length rounding alone cannot explain Catch the Moment’s 2.67 ms grid change. Both MP3 header classes in these fixtures require zero Python lead correction. Evidence: [diagnostics-wasm-pcm.json](diagnostics-wasm-pcm.json). The exact share of grid error attributable to each resampler was not separately ablated.

**Mobile, theme and contrast.**

The hero, prose, captions, links and previews fit the tested widths; the generator and inspector are hidden and the short desktop-only note is visible. All preview images load. Captions and overall patterns are readable; tiny embedded timing labels remain full-song overview details. There is no page-wide horizontal overflow, but the command example has its own horizontal scrollbar.

| Profile / width | Document scroll width | Tool hidden / note shown | Code box / contents width |

| --- | --- | --- | --- |

| iphone-13 / 390 | 390 | yes / yes | 356 / 650 |

| pixel-7 / 393 | 393 | yes / yes | 359 / 650 |

| phone-360 / 360 | 360 | yes / yes | 326 / 650 |

| phone-430 / 430 | 430 | yes / yes | 396 / 650 |

| desktop / 1440 | 1440 | desktop tool visible | no internal overflow |



The plum surfaces and lavender/rose/purple/coral tokens match the requested theme. Measured ordinary text/control pairs, including the worst primary-button gradient endpoint, reach at least **6.6955:1**. However, a screenshot-backed check found that the mobile Japanese tagline overlays the decorative lavender arc: **#EAA0B7 over composited #524B6C = 3.9549:1** at 21.6 px / weight 500. It requires **4.5:1**, so mobile text contrast **fails AA** at all four tested phone widths. The desktop hero passes. The first DOM-only scan missed the sibling SVG backdrop; [hero-contrast.json](hero-contrast.json) uses CSS foreground colors and a text-hidden screenshot of the actual background at opaque glyph pixels. The criterion is [WCAG 2.2, 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

Screenshot paths: [iPhone full page](screenshots/iphone-13.png), [iPhone hero](screenshots/iphone-13-hero.png), [Pixel full page](screenshots/pixel-7.png), [Pixel previews](screenshots/pixel-7-previews.png), [360 px](screenshots/phone-360.png), [430 px](screenshots/phone-430.png), [360 px command example](screenshots/phone-360-code.png), [desktop](screenshots/desktop.png). Eight of nine unique external links return HTTP 200; the runtime source link returns HTTP 404 ([links.json](links.json)).

**Defects, minimal reproductions and recommended order.**

| ID / priority | Minimal reproduction and observed result | Likely code / first fix |

| --- | --- | --- |

| D1 / first, parity | Run `node --import tsx tests/browser/diagnostics.mts wasm replay`; Catch grid max/median 2.669/1.212 ms, and all four browser-PCM replays diverge. `wasm control` passes all four. | `packages/runtime/src/decode_audio.ts:7–21`; standardize decoder clipping, downmix, resampling and normalization with Python before claiming browser frontend parity. |

| D2 / recovery | Run `node tests/browser/fallback.mjs`; device-creation failure gives `Could not load the model: 9392000`, with no WASM retry. Missing-adapter case succeeds. | `site/worker.ts:64–76`, `src/models.ts:94–98`; retry whole-model initialization on WASM after GPU initialization fails, dispose partial sessions, and show a useful error. [Screenshot](screenshots/fallback-device-failure.png). |

| D3 / mobile AA | Open at 390 px (also 360/393/430); Japanese tagline crosses the arc, contrast 3.955:1 instead of 4.5:1. | `public/styles.css:89,92,240` `.hero-arcs` / `.hero .jp`; move or fade the decorative arc behind the tagline, or give the text a sufficiently dark backing. |

| D4 / link | Click `@ensomi/runtime` under “Run it yourself”; GitHub returns 404 at `ensomi-web/tree/main/packages/runtime`. | `public/index.html:251`; point to a published revision, or verify the destination after the runtime branch lands on main. |

| D5 / strict mobile no-scroll target | At 360 px, scroll to “Run it yourself”: the command box is 326 px wide with 650 px of content and requires horizontal panning. | `public/styles.css:226` `pre` and `public/index.html:253`; wrap/split commands on narrow screens. Page-wide overflow itself passes. |



Fix **D1 first** if browser/Python replay parity is the release gate. D2 and D3 should also be fixed before treating the page as broadly robust and AA compliant. Then repair the link and narrow-screen command layout. Provider selection per graph is the next performance experiment: keep BeatThis on WebGPU and benchmark rows/R2 steps on WASM; the present small-step GPU transfers cost substantially more than CPU execution. Also benchmark parallel loading or packing of the ten initial-state files currently awaited serially in `src/r2/stepper.ts:7–8`; their cold network latency appears inside R2 time. No performance change was made in this task.

Reusable commands and measurement caveats are in [tests/browser/README.md](../../tests/browser/README.md). Only test scripts and evidence were added under the authorized directories; product source was not edited. Raw tensors were served read-only from the existing reference directory; generated bundles, archives, long logs, and frame traces are under `bulk/`.
