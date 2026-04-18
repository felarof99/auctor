#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_ROOT="${1:-out}"

bun "$SCRIPT_DIR/scripts/sync-data.ts" --root "$RESULTS_ROOT"
