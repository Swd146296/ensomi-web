# ensomi-web

Static site for https://ensomi.app: the ensomi R2 page with an in-browser chart generator, deployed as Cloudflare Workers static assets (`wrangler.jsonc`).

- `public/`: the page (`index.html`, `styles.css`, images). The build adds `app.js` and `worker.js`, which are not committed.
- `site/`: the page's TypeScript. `app.ts` drives the form, progress, downloads and inspector; `worker.ts` loads the model and generates in a Web Worker; `player.ts` is the live inspector; `serve.mjs` serves the page locally.
- `packages/runtime/`: `@ensomi/runtime`, R2 in TypeScript over ONNX Runtime ([README](packages/runtime/README.md)).
- `docs/brand.md`: name, principles, palette and voice.

The generator runs in desktop browsers; on screens narrower than 60rem the page shows the explanation and hides the tool. It loads the model from `https://huggingface.co/sed-i/ensomi-r2/resolve/main/onnx/` (about 110 MB, kept in the Cache API) or from a folder the user picks, and ONNX Runtime's `.wasm` files from jsDelivr (`onnxruntime-web@1.23.2`), because Cloudflare static assets are capped at 25 MiB each. It uses WebGPU when the browser offers an adapter, otherwise WebAssembly on one thread; no cross-origin isolation headers are needed.

## Build and run locally

Node and the runtime's dev dependencies are needed (`npm ci` in `packages/runtime`).

```sh
cd packages/runtime
npm run typecheck:site
npm run build:site            # writes public/app.js and public/worker.js
npm run serve:site -- 8080    # http://127.0.0.1:8080/, model from Hugging Face
# or with a local copy of the model repository, served at /model/:
npm run serve:site -- 8080 ../../../ensomi-model/artifacts/release-r2/bulk/hf/ensomi-r2
#   then open http://127.0.0.1:8080/?model=/model/onnx/
```

`?model=<url>` points the page at any folder that holds `runtime.json` and the ONNX files; `?backend=wasm` skips WebGPU. Model files are cached by URL under the cache name in `site/worker.ts`; change that name when the files behind a URL change.

## Deploy

`wrangler deploy` from the repository root, logged in to the Cloudflare account that holds `ensomi.app`. Wrangler runs `npm run build:site` first (`build.command` in `wrangler.jsonc`).

## Licences

The site's code and content are MIT (`LICENSE`, copyright Ensomi Labs). Runtime and protocol code follow EnsomiProtocol's licence, Apache-2.0. The model weights are CC BY-NC-SA 4.0, as the page states; the ONNX export of BeatThis keeps its MIT licence.
