#!/usr/bin/env bash
# Prepare the already-existing synthetic QA runtime for a review checkpoint.
# This migrates the QA database and restarts only qa-app and qa-worker; it does
# not recreate containers, change the LAN binding, reset data, or start a stack.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$ROOT" == "/home/administrator/apper/samvev" ]] || { echo "Unexpected repository root: $ROOT" >&2; exit 2; }
cd "$ROOT"
mkdir -p .local/design-review
exec 9>.local/design-review/operation.lock
flock -n 9 || { echo 'Another design-review operation is running.' >&2; exit 2; }

before_file=".local/design-review/runtime-before-$$.json"
trap 'rm -f "$before_file"' EXIT
inputs_before="$(node scripts/design-review-provenance.mjs verify-inputs)"
source_sha="$(node -e 'const value=JSON.parse(process.argv[1]); if(!/^[a-f0-9]{40}$/.test(value.sourceSha))process.exit(2); process.stdout.write(value.sourceSha)' "$inputs_before")"
node scripts/design-review-provenance.mjs runtime-snapshot >"$before_file"

# Run the canonical additive migrator through the existing app container. Its
# exact synthetic DATABASE_URL and mount identity were established above.
docker exec samvev-m1-qa-app-1 npm run db:migrate
docker restart samvev-m1-qa-app-1 samvev-m1-qa-worker-1 >/dev/null

wait_healthy() {
  local container="$1"
  for _ in $(seq 1 60); do
    [[ "$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || true)" == healthy ]] && return 0
    sleep 2
  done
  echo "Timed out waiting for $container." >&2
  return 1
}
wait_healthy samvev-m1-qa-app-1
wait_healthy samvev-m1-qa-worker-1

inputs_after="$(node scripts/design-review-provenance.mjs verify-inputs)"
[[ "$inputs_before" == "$inputs_after" ]] || { echo 'Canonical inputs changed during runtime preparation.' >&2; exit 2; }
node scripts/design-review-provenance.mjs write-runtime "$before_file" "$source_sha" >/dev/null
echo "Prepared verified synthetic QA runtime for source $source_sha."
