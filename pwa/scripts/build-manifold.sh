#!/bin/sh
# Rebuilds the vendored Manifold WebAssembly bindings (vendor/manifold).
#
# The npm package's loader constructs functions from strings, which the
# site's Content Security Policy forbids — and the app then falls back to
# the old boolean engine without anything visibly breaking. This build
# passes -sDYNAMIC_EXECUTION=0 so the loader never needs eval. Everything
# runs inside the official Emscripten image; nothing to install locally.
#
# Usage: scripts/build-manifold.sh [tag]   (default: the tag in vendor/manifold/VERSION)
set -eu

HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HERE/vendor/manifold"
TAG="${1:-$(cat "$DEST/VERSION")}"
WORK="$(mktemp -d)"
EMSDK_IMAGE="emscripten/emsdk:3.1.61"

cat > "$WORK/build.sh" <<INNER
set -eu
cd /work
git clone --quiet --depth 1 --branch "$TAG" https://github.com/elalish/manifold.git
mkdir -p manifold/buildWASM && cd manifold/buildWASM
emcmake cmake -DCMAKE_BUILD_TYPE=MinSizeRel -DMANIFOLD_TEST=OFF -DMANIFOLD_CBIND=OFF -DMANIFOLD_PAR=OFF \\
  -DCMAKE_EXE_LINKER_FLAGS="-sDYNAMIC_EXECUTION=0" .. > cmake.log
emmake make -j4 manifoldjs > make.log
cp bindings/wasm/manifold.js bindings/wasm/manifold.wasm /work/
INNER

echo "==> Building Manifold $TAG in $EMSDK_IMAGE (a few minutes)"
docker run --rm -v "$WORK":/work "$EMSDK_IMAGE" sh /work/build.sh

if grep -q "new Function(" "$WORK/manifold.js"; then
  echo "error: built loader still uses new Function(); the flag did not take" >&2
  exit 1
fi

cp "$WORK/manifold.js" "$WORK/manifold.wasm" "$DEST/"
echo "$TAG" > "$DEST/VERSION"
rm -rf "$WORK"
echo "==> Done: $(wc -c < "$DEST/manifold.wasm" | tr -d ' ') bytes of wasm in $DEST"
