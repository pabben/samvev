#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

if [[ "$ROOT" != "/home/administrator/apper/samvev" ]]; then
  echo "Unexpected repository root: $ROOT" >&2
  exit 1
fi

ENV_FILE="$ROOT/.env.example"
if [[ -f "$ROOT/.env" ]]; then
  ENV_FILE="$ROOT/.env"
fi

compose() {
  mkdir -p "$ROOT/.local/buildx" "$ROOT/.local/tmp"
  BUILDX_CONFIG="$ROOT/.local/buildx" TMPDIR="$ROOT/.local/tmp" docker compose --project-directory "$ROOT" --env-file "$ENV_FILE" -p samvev-m1 -f "$ROOT/compose.yaml" "$@"
}

usage() {
  cat <<'EOF'
Usage: bash scripts/m1.sh <start|stop|status|logs|test|browser-test|qa-candidates|qa-test|install|lock|reset-demo>

start       Build and start only Samvev M1 runtime services.
stop        Stop only Samvev M1 runtime services; preserve volumes.
status      Show only Samvev M1 Compose service status.
logs        Follow only Samvev M1 service logs.
test        Run the isolated PostgreSQL test service.
browser-test Run browser tests against the Compose app service.
qa-candidates Validate the current unapproved QA visual candidate manifest.
qa-test      Run the destructive, isolated QA acceptance stack and leave it healthy.
install     Refresh the project-local Node dependency volume from package-lock.json.
lock        Regenerate package-lock.json in a labeled project container.
reset-demo  Delete only this project's Compose volumes after explicit synthetic-demo confirmation.
EOF
}

case "${1:-}" in
  start)
    compose up --build --detach app worker
    ;;
  stop)
    compose stop app worker db
    ;;
  status)
    compose ps
    ;;
  logs)
    compose logs --follow --tail=200 app worker db
    ;;
  install)
    compose --profile tools run --rm tools npm ci --ignore-scripts
    ;;
  lock)
    compose --profile tools run --rm lock
    ;;
  test)
    compose --profile test run --rm test
    ;;
  browser-test)
    compose --profile browser run --rm browser
    ;;
  qa-candidates)
    compose --profile qa run --rm --no-deps -e QA_VISUAL_MODE=candidate qa-browser node tests/e2e/visual-regression.mjs
    ;;
  qa-test)
    qa_volume="samvev-m1-qa-postgres-data"
    owned_qa_volume() {
      local candidate
      local matches

      matches="$(docker volume ls --quiet --filter label=com.docker.compose.project=samvev-m1 --filter "name=$qa_volume")"
      if [[ -z "$matches" ]]; then
        return 0
      fi

      while IFS= read -r candidate; do
        if [[ "$candidate" != "$qa_volume" ]]; then
          echo "Refusing unexpected scoped QA volume candidate: $candidate" >&2
          return 1
        fi
        printf '%s\n' "$candidate"
      done <<< "$matches"
    }
    assert_qa_volume() {
      local owned_volume
      local project_label

      owned_volume="$(owned_qa_volume)"
      if [[ "$owned_volume" != "$qa_volume" ]]; then
        echo "Expected a newly created $qa_volume with the samvev-m1 project label." >&2
        return 1
      fi
      project_label="$(docker volume inspect --format '{{ index .Labels "com.docker.compose.project" }}' "$owned_volume")"
      if [[ "$project_label" != "samvev-m1" ]]; then
        echo "Refusing to use $qa_volume: expected samvev-m1 project label." >&2
        return 1
      fi
    }
    clean_qa() {
      local owned_volume

      owned_volume="$(owned_qa_volume)"
      compose --profile qa rm --stop --force qa-app qa-worker qa-migrate qa-db

      if [[ -n "$owned_volume" ]]; then
        assert_qa_volume
        docker volume rm "$owned_volume"
      fi
    }
    clean_qa
    compose --profile qa create qa-db
    assert_qa_volume
    compose --profile qa up --detach --build qa-app qa-worker
    compose --profile qa run --rm --no-deps qa-browser node tests/e2e/m1-demo-and-accessibility.mjs
    clean_qa
    compose --profile qa create qa-db
    assert_qa_volume
    compose --profile qa up --detach --build qa-app qa-worker
    compose --profile qa run --rm --no-deps -e SMOKE_ARTIFACT_DIR=docs/implementation/artifacts/qa-final qa-browser node apps/web/tests/smoke.mjs
    compose --profile qa run --rm --no-deps -e SMOKE_ARTIFACT_DIR=docs/implementation/artifacts/qa-final/review qa-browser node apps/web/tests/review-regressions.mjs
    compose --profile qa run --rm --no-deps -e UX_ARTIFACT_DIR=docs/implementation/artifacts/qa-final/ux qa-browser node apps/web/tests/ux-states.mjs
    compose --profile qa run --rm --no-deps -e QA_PHASE=restart-pre qa-browser
    compose --profile qa stop qa-worker
    sleep 45
    compose --profile qa start qa-worker
    compose --profile qa run --rm --no-deps -e QA_PHASE=post qa-browser
    compose --profile qa run --rm --no-deps -e VISUAL_CANDIDATE_DIR=docs/implementation/artifacts/qa-final -e QA_VISUAL_MODE=compare qa-browser node tests/e2e/visual-regression.mjs
    ;;
  reset-demo)
    if [[ "${2:-}" != "--confirm-synthetic-demo" ]]; then
      echo "Refusing to delete volumes. Run: bash scripts/m1.sh reset-demo --confirm-synthetic-demo" >&2
      exit 2
    fi
    if ! grep -qx 'SAMVEV_DEMO_MODE=true' "$ENV_FILE"; then
      echo "Refusing reset because SAMVEV_DEMO_MODE=true is not set in $ENV_FILE." >&2
      exit 2
    fi
    compose down --volumes
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
