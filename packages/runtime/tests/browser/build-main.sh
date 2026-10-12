#!/bin/sh
# Builds the page at a commit with the TypeScript runtime (default 9d8e725, main before the Wasm switch) into
# artifacts/bulk/main/public, for old-versus-new runs. checks/same-as-ts.mjs reads that commit's runtime from
# artifacts/bulk/main/packages/runtime/src. Run from packages/runtime: tests/browser/build-main.sh [commit]
#   ENSOMI_SITE=artifacts/bulk/main/site tests/browser/speed.sh old 1 "webgpu wasm" "adventure catch-the-moment"
set -e
commit=${1:-9d8e725}
rm -rf artifacts/bulk/main
mkdir -p artifacts/bulk/main
git -C ../.. archive "$commit" site public packages/runtime/src | tar -x -C artifacts/bulk/main
npx esbuild artifacts/bulk/main/site/app.ts artifacts/bulk/main/site/worker.ts --bundle --format=esm --target=es2022 --minify --outdir=artifacts/bulk/main/public --log-level=warning
