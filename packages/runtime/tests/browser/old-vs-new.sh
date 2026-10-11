#!/bin/bash
# Old against new in pairs: for each round, song and provider, the page built from main 9d8e725 with the TypeScript runtime
# (tests/browser/build-main.sh, port 8088) and this build (port 8087) back to back, each in a fresh Chrome through
# page-matrix.mjs with one song (cold, then warm). The order alternates by round, and the 1-minute load average before
# each run goes into the summary, since other jobs on the machine move absolute times.
# Run from packages/runtime: tests/browser/old-vs-new.sh <label> [rounds] [songs]
set -u
label=$1 rounds=${2:-3} songs=${3:-"adventure catch-the-moment hesitation-snow saigetsu"}
model=../../../ensomi-model/artifacts/release-r2/bulk/hf/ensomi-r2 out=artifacts/speed/runs
mkdir -p "$out"
npm run build:site || exit 1
[ -d artifacts/bulk/main/public ] || tests/browser/build-main.sh || exit 1
node ../../site/serve.mjs 8087 "$model" > /dev/null &
new=$!
node artifacts/bulk/main/site/serve.mjs 8088 "$model" > /dev/null &
old=$!
trap 'kill $new $old' EXIT
sleep 1
for r in $(seq "$rounds"); do
  for song in $songs; do
    for p in webgpu wasm; do
      order="old new"; [ $((r % 2)) -eq 0 ] && order="new old"
      for b in $order; do
        port=8087; [ "$b" = old ] && port=8088
        load=$(sysctl -n vm.loadavg | awk '{print $2}')
        ENSOMI_TEST_URL=http://127.0.0.1:$port node tests/browser/page-matrix.mjs "$p" local "$song" > /dev/null 2>&1
        echo "round $r $song $p $b: exit $?, load $load"
        cp "artifacts/browser-test/page-$p-local-$song.json" "$out/$label-$b-$r-$p-local-$song.json"
      done
    done
  done
done
node tests/browser/speed-summary.mjs "$out/$label"-*.json
