#!/bin/sh
# Rebuilds the vendored runtime from an ensomi-runtime checkout: the Wasm core with its wasm-bindgen glue (pkg/) and
# the JavaScript API (src/), copied from that repository's js/, and provenance.json naming the commit and the build.
# Needs what ensomi-runtime's scripts/wasm-build.sh needs.
# Run from packages/runtime: scripts/vendor.sh [ensomi-runtime directory, default ../../../ensomi-runtime]
# RUNTIME_COMMIT names the commit when that directory is not a git checkout of its own (bings-mac's synced copy).
set -eu
runtime=$(cd "${1:-../../../ensomi-runtime}" && pwd)
if [ -z "${RUNTIME_COMMIT:-}" ]; then
  [ "$(git -C "$runtime" rev-parse --show-toplevel)" = "$runtime" ] || { echo "$runtime is not a git checkout; set RUNTIME_COMMIT" >&2; exit 1; }
  RUNTIME_COMMIT=$(git -C "$runtime" rev-parse HEAD)
fi
build="scripts/wasm-build.sh"
(cd "$runtime" && sh -c "$build")
rm -rf src pkg
cp -R "$runtime/js/src" src
cp -R "$runtime/js/pkg" pkg
cat > provenance.json <<JSON
{
  "repository": "https://github.com/ensomi-labs/runtime",
  "commit": "$RUNTIME_COMMIT",
  "build": "$build",
  "copied": { "src/": "js/src/", "pkg/": "js/pkg/" },
  "rustc": "$(rustc --version)",
  "wasm-bindgen": "$(wasm-bindgen --version)"
}
JSON
