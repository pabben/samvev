#!/usr/bin/env bash
# Explicit immutable-checkpoint build step. It does not start/restart QA services.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
[[ -d .local/design-review-publish/.git ]] || { echo 'Missing canonical publishing checkout.' >&2; exit 2; }
container=samvev-m1-qa-app-1
[[ "$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container" 2>/dev/null)" == samvev-m1 ]] || exit 2
[[ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" == healthy ]] || exit 2
node scripts/design-review-provenance.mjs verify >/dev/null 2>&1 && { echo 'Refusing: existing proof already matches; build is unnecessary.' >&2; exit 2; } || true
source_sha="$(node -e "import('./scripts/design-review-provenance.mjs').then(m=>m.verifyInputs().then(v=>console.log(v.sourceSha)))")"
node_version="$(docker exec "$container" node --version)"
[[ "$node_version" == v24.* ]] || { echo "Expected Node 24 in QA app, got $node_version" >&2; exit 2; }
docker exec "$container" npm run build --workspace @samvev/web
container_id="$(docker inspect --format '{{.Id}}' "$container")"
node -e "import('./scripts/design-review-provenance.mjs').then(m=>m.writeProof({containerId:process.argv[1],nodeVersion:process.argv[2],expectedSourceSha:process.argv[3]}))" "$container_id" "$node_version" "$source_sha" >/dev/null
