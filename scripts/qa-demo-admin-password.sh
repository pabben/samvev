#!/usr/bin/env bash
# Apply the explicit admin/admin credential only to the existing synthetic QA demo.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$ROOT" == "/home/administrator/apper/samvev" ]] || { echo "Unexpected repository root: $ROOT" >&2; exit 2; }
cd "$ROOT"

require_qa_service() {
  local service="$1"
  local container="samvev-m1-${service}-1"
  [[ "$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container" 2>/dev/null)" == "samvev-m1" ]] || { echo "Missing Samvev QA container: $container" >&2; exit 2; }
  [[ "$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$container")" == "$service" ]] || { echo "Unexpected Compose service for $container" >&2; exit 2; }
  [[ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" == "healthy" ]] || { echo "QA service is not healthy: $service" >&2; exit 2; }
}

require_qa_service qa-db
require_qa_service qa-app

app_env="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' samvev-m1-qa-app-1)"
db_env="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' samvev-m1-qa-db-1)"
db_mount="$(docker inspect --format '{{range .Mounts}}{{println .Name}}{{end}}' samvev-m1-qa-db-1)"
grep -qx 'DATABASE_URL=postgresql://samvev_qa:synthetic-qa-data-only@qa-db:5432/samvev_qa' <<<"$app_env"
grep -qx 'SAMVEV_DEMO_MODE=true' <<<"$app_env"
grep -Eqx 'SAMVEV_PUBLIC_ORIGIN=http://(qa-app|192\.168\.0\.220):4173' <<<"$app_env"
grep -qx 'POSTGRES_DB=samvev_qa' <<<"$db_env"
grep -qx 'POSTGRES_USER=samvev_qa' <<<"$db_env"
grep -qx 'POSTGRES_PASSWORD=synthetic-qa-data-only' <<<"$db_env"
grep -qx 'samvev-m1-qa-postgres-data' <<<"$db_mount"

docker exec --workdir /workspace samvev-m1-qa-app-1 \
  ./node_modules/.bin/tsx scripts/qa-demo-admin-password.mts
