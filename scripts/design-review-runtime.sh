#!/usr/bin/env bash
# Explicitly activate an already built artifact; qa-app starts without compiling.
set -euo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$ROOT" == /home/administrator/apper/samvev ]] || exit 2
cd "$ROOT"
mkdir -p .local/design-review
exec 9>.local/design-review/operation.lock
flock -n 9 || { echo 'Another design-review operation is running.' >&2; exit 2; }
node scripts/design-review-pipeline.mjs activate
