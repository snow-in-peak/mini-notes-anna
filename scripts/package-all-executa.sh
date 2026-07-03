#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXECUTA_DIR="$ROOT/executas/mini-notes-summary-go"
NAME="mini-notes-summary"
VERSION="0.1.0"
RELEASE_DIR="$ROOT/release"
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
  cat > "$build_dir/manifest.json" <<JSON
{
  "name": "$NAME",
  "display_name": "Mini Notes Summary",
  "version": "$VERSION",
  "description": "Summarizes Mini Notes through Anna host LLM sampling.",
  "host_capabilities": ["llm.sample"],
  "runtime": {
    "binary": {
      "entrypoint": "bin/$NAME$ext"
    }
  }
}
JSON
  if [[ "$format" == "zip" ]]; then
    (cd "$build_dir" && zip -qr "$RELEASE_DIR/$NAME-$platform.zip" manifest.json bin)
    sha256sum "$RELEASE_DIR/$NAME-$platform.zip" > "$RELEASE_DIR/$NAME-$platform.zip.sha256"
  else
    (cd "$build_dir" && tar -czf "$RELEASE_DIR/$NAME-$platform.tar.gz" manifest.json bin)
    sha256sum "$RELEASE_DIR/$NAME-$platform.tar.gz" > "$RELEASE_DIR/$NAME-$platform.tar.gz.sha256"
  fi
}

build_one darwin-arm64 darwin arm64 "" tar.gz
build_one darwin-x86_64 darwin amd64 "" tar.gz
build_one windows-x86_64 windows amd64 ".exe" zip

echo "Built release assets:"
ls -lh "$RELEASE_DIR"/mini-notes-summary-darwin-arm64.tar.gz "$RELEASE_DIR"/mini-notes-summary-darwin-x86_64.tar.gz "$RELEASE_DIR"/mini-notes-summary-windows-x86_64.zip
