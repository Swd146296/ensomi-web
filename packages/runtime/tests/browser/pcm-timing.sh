#!/bin/bash
# Warm WebGPU timing of the Exact timing option, off and on, through pcm-timing.mjs: builds the page, serves it on port
# 8087 with the release model and records the 1-minute load average before and after, since other jobs on the machine
# move the times. Run from packages/runtime: tests/browser/pcm-timing.sh
set -u
npm run build:site || exit 1
node ../../site/serve.mjs 8087 ../../../ensomi-model/artifacts/release-r2/bulk/hf/ensomi-r2 > /dev/null &
server=$!
trap 'kill $server' EXIT
sleep 1
sysctl -n vm.loadavg
node tests/browser/pcm-timing.mjs
status=$?
sysctl -n vm.loadavg
exit $status
