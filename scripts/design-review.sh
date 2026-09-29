#!/usr/bin/env bash
# Capture the existing synthetic M3 QA member Home. This script never starts,
# rebuilds, resets, or changes the QA stack.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$ROOT" == "/home/administrator/apper/samvev" ]] || { echo "Unexpected repository root: $ROOT" >&2; exit 2; }
cd "$ROOT"

require_healthy() {
  local service="$1"
  local container="samvev-m1-${service}-1"
  [[ "$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container" 2>/dev/null)" == "samvev-m1" ]] || { echo "Missing Samvev QA container: $container" >&2; exit 2; }
  [[ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" == "healthy" ]] || { echo "QA service is not healthy: $service" >&2; exit 2; }
}
require_healthy qa-db
require_healthy qa-worker
require_healthy qa-app

app_env="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' samvev-m1-qa-app-1)"
db_env="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' samvev-m1-qa-db-1)"
worker_env="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' samvev-m1-qa-worker-1)"
db_mount="$(docker inspect --format '{{range .Mounts}}{{println .Name}}{{end}}' samvev-m1-qa-db-1)"
grep -qx 'DATABASE_URL=postgresql://samvev_qa:synthetic-qa-data-only@qa-db:5432/samvev_qa' <<<"$app_env"
grep -qx 'SAMVEV_DEMO_MODE=true' <<<"$app_env"
grep -qx 'DATABASE_URL=postgresql://samvev_qa:synthetic-qa-data-only@qa-db:5432/samvev_qa' <<<"$worker_env"
grep -qx 'POSTGRES_DB=samvev_qa' <<<"$db_env"
grep -qx 'POSTGRES_USER=samvev_qa' <<<"$db_env"
grep -qx 'POSTGRES_PASSWORD=synthetic-qa-data-only' <<<"$db_env"
grep -qx 'samvev-m1-qa-postgres-data' <<<"$db_mount"

# The browser service is on the isolated samvev-m1 network. The capture module
# has no URL argument and always uses http://qa-app:4173.
source_sha="$(git rev-parse HEAD)"
[[ "$source_sha" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid source SHA.' >&2; exit 2; }
working_tree_dirty=false
[[ -n "$(git status --porcelain)" ]] && working_tree_dirty=true
docker compose --project-directory "$ROOT" --env-file "$ROOT/.env.example" -p samvev-m1 -f "$ROOT/compose.yaml" --profile qa \
  run --rm --no-deps -e DESIGN_REVIEW_SOURCE_SHA="$source_sha" -e DESIGN_REVIEW_WORKING_TREE_DIRTY="$working_tree_dirty" qa-browser node scripts/design-review.mjs
