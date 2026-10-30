#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
export SOURCE="$PWD" COMPOSE_IGNORE_ORPHANS=true
export PROOF_ID="$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
db="samvev-m1-display-proof-db-$PROOF_ID"
api="samvev-m1-display-proof-api-$PROOF_ID"
browser="samvev-m1-display-proof-browser-$PROOF_ID"
network="samvev-m1-display-proof-$PROOF_ID"
compose=(docker compose --env-file /dev/null -p samvev-m1 -f tests/e2e/display-proof/compose.yaml)
for name in "$db" "$api" "$browser"; do if docker inspect "$name" >/dev/null 2>&1; then exit 1; fi; done
if docker network inspect "$network" >/dev/null 2>&1; then exit 1; fi
cleanup() {
  for name in "$browser" "$api" "$db"; do
    project=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$name" 2>/dev/null || true)
    if [[ "$project" == samvev-m1 ]]; then docker rm -f "$name" >/dev/null; fi
  done
  project=$(docker network inspect -f '{{index .Labels "com.docker.compose.project"}}' "$network" 2>/dev/null || true)
  if [[ "$project" == samvev-m1 ]]; then docker network rm "$network" >/dev/null; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"${compose[@]}" run --no-deps --use-aliases -d --name "$db" proof-db >/dev/null
docker inspect "$db" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const c=JSON.parse(s)[0];if(c.Config.Labels["com.docker.compose.project"]!=="samvev-m1" || c.Config.Labels["com.docker.compose.service"]!=="proof-db" || c.HostConfig.NetworkMode==="host" || c.HostConfig.Privileged || c.Mounts.some(m=>m.Type!=="tmpfs" || m.Destination!=="/var/lib/postgresql/data") || !Object.hasOwn(c.HostConfig.Tmpfs||{},"/var/lib/postgresql/data") || Object.keys(c.HostConfig.PortBindings||{}).length)process.exit(1)})'
for i in $(seq 1 60); do
  if docker exec "$db" pg_isready -U display_proof -d display_proof >/dev/null 2>&1; then break; fi
  [[ "$i" != 60 ]] || exit 1
  sleep 1
done
"${compose[@]}" run --no-deps --use-aliases -d --name "$api" proof-api >/dev/null
for i in $(seq 1 60); do
  if docker exec "$api" sh -c 'curl -fsS http://127.0.0.1:4173/api/v1/health >/dev/null' 2>/dev/null; then break; fi
  if [[ "$(docker inspect -f '{{.State.Running}}' "$api")" != true || "$i" == 60 ]]; then docker logs "$api"; exit 1; fi
  sleep 1
done
"${compose[@]}" run --rm --no-deps --name "$browser" proof-browser
