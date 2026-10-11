#!/bin/bash
# Speed runs through page-matrix.mjs on the built page, one song per browser session (cold, then warm).
# Run from packages/runtime: tests/browser/speed.sh <label> [repeats] [providers] [songs] [source]
#   tests/browser/speed.sh after-l1 2 "webgpu wasm" adventure
# Each run's page JSON is kept under artifacts/speed/runs/; the summary prints per-phase seconds and chart hashes.
set -u
label=$1 repeats=${2:-1} providers=${3:-"webgpu wasm"} songs=${4:-adventure} source=${5:-local}
out=artifacts/speed/runs
mkdir -p "$out"
npm run build:site || exit 1
node ../../site/serve.mjs 8087 ../../../ensomi-model/artifacts/release-r2/bulk/hf/ensomi-r2 &
server=$!
trap 'kill $server' EXIT
sleep 1
for r in $(seq "$repeats"); do
  for song in $songs; do
    for p in $providers; do
      node tests/browser/page-matrix.mjs "$p" "$source" "$song"
      cp "artifacts/browser-test/page-$p-$source-$song.json" "$out/$label-$p-$source-$song-$r.json"
    done
  done
done
node tests/browser/speed-summary.mjs "$out/$label"-*.json
