#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXECUTA_DIR="$ROOT/executas/mini-notes-summary-go"
NAME="mini-notes-summary"
VERSION="0.1.0"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$OS-$ARCH" in
  darwin-arm64|darwin-aarch64) PLATFORM="darwin-arm64"; GOOS="darwin"; GOARCH="arm64"; EXT=""; FORMAT="tar.gz" ;;
  darwin-x86_64|darwin-amd64) PLATFORM="darwin-x86_64"; GOOS="darwin"; GOARCH="amd64"; EXT=""; FORMAT="tar.gz" ;;
  linux-x86_64|linux-amd64) PLATFORM="linux-x86_64"; GOOS="linux"; GOARCH="amd64"; EXT=""; FORMAT="tar.gz" ;;
  linux-aarch64|linux-arm64) PLATFORM="linux-arm64"; GOOS="linux"; GOARCH="arm64"; EXT=""; FORMAT="tar.gz" ;;
  msys_nt*-x86_64|mingw*-x86_64|cygwin*-x86_64) PLATFORM="windows-x86_64"; GOOS="windows"; GOARCH="amd64"; EXT=".exe"; FORMAT="zip" ;;
  *) echo "Unsupported host platform: $OS-$ARCH" >&2; exit 1 ;;
esac

BUILD_DIR="$ROOT/build/$PLATFORM"
RELEASE_DIR="$ROOT/release"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/bin" "$RELEASE_DIR"

(
  cd "$EXECUTA_DIR"
  GOOS="$GOOS" GOARCH="$GOARCH" CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "$BUILD_DIR/bin/$NAME$EXT" .
)

cat > "$BUILD_DIR/manifest.json" <<JSON
{
  "name": "$NAME",
  "display_name": "Mini Notes Summary",
  "version": "$VERSION",
  "description": "Summarizes Mini Notes through Anna host LLM sampling.",
  "host_capabilities": ["llm.sample"],
  "runtime": {
    "binary": {
      "entrypoint": "bin/$NAME$EXT"
    }
  }
}
JSON

if [[ "$FORMAT" == "zip" ]]; then
  ARCHIVE="$RELEASE_DIR/$NAME-$PLATFORM.zip"
  (cd "$BUILD_DIR" && zip -qr "$ARCHIVE" manifest.json bin)
else
  ARCHIVE="$RELEASE_DIR/$NAME-$PLATFORM.tar.gz"
  (cd "$BUILD_DIR" && tar -czf "$ARCHIVE" manifest.json bin)
fi

sha256sum "$ARCHIVE" | tee "$ARCHIVE.sha256"
stat -c '%n %s bytes' "$ARCHIVE"
echo "Built $ARCHIVE"
