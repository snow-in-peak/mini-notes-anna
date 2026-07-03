#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
exec /usr/local/go/bin/go run .
