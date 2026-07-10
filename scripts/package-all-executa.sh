#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXECUTA_DIR="$ROOT/executas/mini-notes-summary-go"
RELEASE_DIR="$ROOT/release"

# shellcheck source=./executa-manifest.sh
source "$ROOT/scripts/executa-manifest.sh"

mkdir -p "$RELEASE_DIR"

build_one() {
  local platform="$1" goos="$2" goarch="$3" ext="$4" format="$5"
  local build_dir="$ROOT/build/$platform"

  rm -rf "$build_dir"
  mkdir -p "$build_dir/bin"
  (
    cd "$EXECUTA_DIR"
    GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "$build_dir/bin/$NAME$ext" .
  )

  write_manifest "$build_dir" "$platform" "$ext"
  archive_platform "$build_dir" "$platform" "$format" "$RELEASE_DIR" >/dev/null
}

# Assert the archive root holds exactly manifest.json + the declared entrypoint,
# and that manifest.runtime.entrypoint points at a path the archive really has.
verify_archive() {
  local platform="$1" format="$2" archive listing entrypoint
  local expected="bin/$NAME"
  [[ "$format" == "zip" ]] && expected="bin/$NAME.exe"

  if [[ "$format" == "zip" ]]; then
    archive="$RELEASE_DIR/$NAME-$platform.zip"
    listing="$(unzip -Z1 "$archive")"
  else
    archive="$RELEASE_DIR/$NAME-$platform.tar.gz"
    listing="$(tar -tzf "$archive")"
  fi

  grep -qx "manifest.json" <<<"$listing" \
    || { echo "✗ $platform: archive root is missing manifest.json" >&2; exit 1; }
  grep -qx "$expected" <<<"$listing" \
    || { echo "✗ $platform: archive is missing $expected" >&2; exit 1; }

  entrypoint="$(sed -n 's/.*"entrypoint"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/build/$platform/manifest.json")"
  [[ "$entrypoint" == "$expected" ]] \
    || { echo "✗ $platform: manifest entrypoint '$entrypoint' != '$expected'" >&2; exit 1; }

  echo "✓ $platform: manifest.json + $expected"
}

build_one darwin-arm64  darwin  arm64 ""     tar.gz
build_one darwin-x86_64 darwin  amd64 ""     tar.gz
build_one windows-x86_64 windows amd64 ".exe" zip

echo "Verifying archive layout:"
verify_archive darwin-arm64   tar.gz
verify_archive darwin-x86_64  tar.gz
verify_archive windows-x86_64 zip

echo "Built release assets:"
ls -lh "$RELEASE_DIR/$NAME-darwin-arm64.tar.gz" \
       "$RELEASE_DIR/$NAME-darwin-x86_64.tar.gz" \
       "$RELEASE_DIR/$NAME-windows-x86_64.zip"
