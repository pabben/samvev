#!/usr/bin/env bash
# Explicit immutable-checkpoint build step. It does not start/restart QA services.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
[[ "$ROOT" == "/home/administrator/apper/samvev" ]] || { echo "Unexpected repository root: $ROOT" >&2; exit 2; }
mkdir -p .local/design-review
exec 9>.local/design-review/operation.lock
flock -n 9 || { echo 'Another design-review operation is running.' >&2; exit 2; }
[[ -d .local/design-review-publish/.git ]] || { echo 'Missing canonical publishing checkout.' >&2; exit 2; }
container=samvev-m1-qa-app-1
runtime_before="$(node scripts/design-review-provenance.mjs verify-runtime)"
source_sha="$(node -e "import('./scripts/design-review-provenance.mjs').then(m=>m.verifyInputs().then(v=>console.log(v.sourceSha)))")"
node_version="$(docker exec "$container" node --version)"
[[ "$node_version" == v24.* ]] || { echo "Expected Node 24 in QA app, got $node_version" >&2; exit 2; }
docker exec "$container" npm run build --workspace @samvev/web
container_id="$(docker inspect --format '{{.Id}}' "$container")"
runtime_after="$(node scripts/design-review-provenance.mjs verify-runtime)"
[[ "$runtime_before" == "$runtime_after" ]] || { echo 'QA runtime changed during build.' >&2; exit 2; }
node -e "import('./scripts/design-review-provenance.mjs').then(m=>m.writeProof({containerId:process.argv[1],nodeVersion:process.argv[2],expectedSourceSha:process.argv[3]}))" "$container_id" "$node_version" "$source_sha" >/dev/null
echo "Built and proved web assets for source $source_sha."
