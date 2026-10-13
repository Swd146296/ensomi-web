# ensomi-web

Static site for https://ensomi.app: the ensomi R2 page with an in-browser chart generator, deployed as Cloudflare Workers static assets (`wrangler.jsonc`).

- `public/`: the page (`index.html`, `styles.css`, images). The build adds `app.js`, `worker.js`, the runtime's `ensomi-runtime.wasm` and its resampler tables (`resampler/`), which are not committed.
- `site/`: the page's TypeScript. `app.ts` drives the form, progress, downloads and inspector; `audio.ts` decodes the song at its own sample rate for the Exact timing option, so that the runtime converts the rate as the Python release does; `worker.ts` loads the model and generates in a Web Worker; `player.ts` is the live inspector; `serve.mjs` serves the page locally.
- `package.json`: the site's one dependency, [`@ensomi/runtime`](https://www.npmjs.com/package/@ensomi/runtime) at exactly 0.3.0, the WebAssembly build of ensomi's Rust runtime with its JavaScript API over ONNX Runtime Web, and the build and test tools.
- `packages/runtime/`: the runtime's checks in this site, the browser tests and their report ([README](packages/runtime/README.md)).
- `docs/brand.md`: name, principles, palette and voice.

The generator runs in desktop browsers; on screens narrower than 60rem the page shows the explanation and hides the tool. It loads the model from the release tag, `https://huggingface.co/sed-i/ensomi-r2/resolve/r2-1.0/onnx/` (about 120 MB, kept in the Cache API), or from a folder the user picks, and ONNX Runtime's `.wasm` files from jsDelivr (`onnxruntime-web@1.23.2`), because Cloudflare static assets are capped at 25 MiB each. BeatThis runs on WebGPU when the browser offers an adapter; the per-row rows and R2 graphs, and BeatThis without WebGPU, run on WebAssembly. If WebGPU fails while loading, the page loads everything on WebAssembly instead. `public/_headers` makes the page cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless`), which WebAssembly threads need: two next to WebGPU, four without it. Browsers that do not support `credentialless` (Safari) run WebAssembly on one thread. `site/serve.mjs` sends the same two headers.

## Build and run locally

Node is needed; install the dependencies with `npm ci` in the repository root.

```sh
npm ci
npm run typecheck:site
npm run build:site            # writes public/app.js, worker.js, ensomi-runtime.wasm and resampler/
npm run serve:site -- 8080    # http://127.0.0.1:8080/, model from Hugging Face
# or with a local copy of the model repository, served at /model/:
npm run serve:site -- 8080 ../ensomi-model/artifacts/release-r2/bulk/hf/ensomi-r2
#   then open http://127.0.0.1:8080/?model=/model/onnx/
```

`?model=<url>` points the page at any folder that holds `runtime.json` and the ONNX files; `?backend=wasm` skips WebGPU. Model files are cached by URL under the cache name in `site/worker.ts`; change that name when the model URL in `site/app.ts` or the files behind a URL change. Loading deletes the caches of other names.

## Deploy

`wrangler deploy` from the repository root, logged in to the Cloudflare account that holds `ensomi.app`. Wrangler runs `npm run build:site` first (`build.command` in `wrangler.jsonc`).

## Licences

The site's code and content are MIT (`LICENSE`, copyright Ensomi Labs). `@ensomi/runtime` is Apache-2.0 under its own licence, shipped in its npm package, and so are the runtime's checks and browser tests in `packages/runtime/` (`packages/runtime/LICENSE`). ONNX Runtime Web is MIT. The model weights are CC BY-NC-SA 4.0, as the page states; BeatThis's ONNX export and front-end arrays keep its MIT licence (`onnx/BeatThis-LICENSE.txt` in the model repository).
