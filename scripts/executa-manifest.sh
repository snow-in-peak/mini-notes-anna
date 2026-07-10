#!/usr/bin/env bash
# Shared archive-root manifest.json emitter, sourced by package-executa.sh and
# package-all-executa.sh so the two paths cannot drift.

NAME="mini-notes-summary"
DISPLAY_NAME="Mini Notes Summary"
VERSION="0.1.0"
DESCRIPTION="Summarizes Mini Notes by requesting host LLM sampling over reverse JSON-RPC."

# write_manifest <dest-dir> <platform-key> <exe-ext>
# Emits the archive-root manifest.json describing the packaged binary.
# The entrypoint here must stay in sync with the matching
# `distribution.profiles.binary.binary_urls["<platform>"].entrypoint`
# in executas/mini-notes-summary-go/executa.json — that is the field the
# Anna CLI actually resolves when installing a binary executa.
write_manifest() {
  local dest="$1" platform="$2" ext="$3"
  cat > "$dest/manifest.json" <<JSON
{
  "name": "$NAME",
  "display_name": "$DISPLAY_NAME",
  "version": "$VERSION",
  "description": "$DESCRIPTION",
  "platform": "$platform",
  "runtime": {
    "type": "binary",
    "entrypoint": "bin/$NAME$ext"
  },
  "permissions": [],
  "host_capabilities": ["llm.sample"]
}
JSON
}

# archive_platform <dest-dir> <platform-key> <format> <release-dir>
# Packs manifest.json + bin/ from <dest-dir> into the release archive and
# writes a sibling .sha256. Archive root contains exactly manifest.json and bin/.
archive_platform() {
  local dest="$1" platform="$2" format="$3" release_dir="$4" archive

  if [[ "$format" == "zip" ]]; then
    archive="$release_dir/$NAME-$platform.zip"
    rm -f "$archive"
    (cd "$dest" && zip -qr "$archive" manifest.json bin)
  else
    archive="$release_dir/$NAME-$platform.tar.gz"
    rm -f "$archive"
    (cd "$dest" && tar -czf "$archive" manifest.json bin)
  fi

  (cd "$release_dir" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
  printf '%s\n' "$archive"
}
