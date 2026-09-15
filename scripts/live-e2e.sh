#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

if [[ "$ROOT" != "/home/administrator/apper/samvev" ]]; then
  echo "Unexpected repository root: $ROOT" >&2
  exit 1
fi

if [[ "$-" == *x* ]] || [[ -n "${BASH_XTRACEFD:-}" ]]; then
  echo "Refusing to run while shell tracing is enabled." >&2
  exit 2
fi

ENV_FILE="$ROOT/.env.example"
if [[ -f "$ROOT/.env" ]]; then
  ENV_FILE="$ROOT/.env"
fi

LOCAL_DIR="$ROOT/.local/live-e2e"
CREDENTIALS_DIR="$LOCAL_DIR/credentials"
REPORTS_DIR="$LOCAL_DIR/reports"
CREDENTIALS_REL=".local/live-e2e/credentials/credentials.json"
AI_SETTINGS_REL=".local/live-e2e/ai-settings.json"
CREDENTIALS_FILE="$ROOT/$CREDENTIALS_REL"
AI_SETTINGS_FILE="$ROOT/$AI_SETTINGS_REL"
# npm --workspace changes cwd to /workspace/services/api. Pass the same
# absolute mount paths to provisioning and the browser regardless of npm cwd.
CONTAINER_ROOT="/workspace"
CONTAINER_CREDENTIALS_FILE="$CONTAINER_ROOT/$CREDENTIALS_REL"
CONTAINER_AI_SETTINGS_FILE="$CONTAINER_ROOT/$AI_SETTINGS_REL"

compose() {
  mkdir -p "$ROOT/.local/buildx" "$ROOT/.local/tmp"
  install -d -m 700 "$LOCAL_DIR" "$CREDENTIALS_DIR" "$REPORTS_DIR"
  chmod 700 "$LOCAL_DIR" "$CREDENTIALS_DIR" "$REPORTS_DIR"
  BUILDX_CONFIG="$ROOT/.local/buildx" TMPDIR="$ROOT/.local/tmp" docker compose --project-directory "$ROOT" --env-file "$ENV_FILE" -p samvev-m1 -f "$ROOT/compose.yaml" "$@"
}

usage() {
  cat <<'EOF'
Usage: bash scripts/live-e2e.sh <provision|run>

provision  Create or verify the one registered synthetic account through the
           supported candidate-image CLI. Requires an immutable runtime image.
run        Run the authenticated browser/API matrix against the confirmed origin.

Both commands require SAMVEV_E2E_ORIGIN and SAMVEV_E2E_CONFIRM_ORIGIN to be
exactly equal. Provision additionally needs SAMVEV_E2E_RUNTIME_IMAGE and run
needs SAMVEV_E2E_HARNESS_IMAGE, each as name@sha256:... image digests.

Credential and AI settings files are fixed under .local/live-e2e/. Their contents
never appear in command arguments, Git or Compose environment values. The browser
gets them read-only and can write only its separate reports directory.
For supplemental isolated QA, SAMVEV_E2E_PUBLIC_SOURCE_URL may identify an
operator-approved public HTTPS source. It is validated by the harness and never
printed; the normal server source/SSRF policy still applies.
SAMVEV_E2E_SCENARIOS may select comma-separated diagnostic cases only from
weather,via-yr,web+weather,negative. Omit it for the full release matrix.
Filtered successes are reported as diagnostics, never full LIVE E2E PASS.
EOF
}

require_digest_image() {
  local variable="$1"
  local value="${!variable:-}"
  if [[ ! "$value" =~ @sha256:[0-9a-f]{64}$ ]]; then
    echo "$variable must be an immutable image digest (name@sha256:...)." >&2
    exit 2
  fi
}

require_safe_file() {
  local file="$1"
  if [[ ! -f "$file" || -L "$file" ]]; then
    echo "Expected a regular credential file: $file" >&2
    exit 2
  fi
  if [[ "$(stat -c '%u' "$file")" != "$(id -u)" || "$(stat -c '%a' "$file")" != "600" ]]; then
    echo "Credential files must be owned by the invoking user with mode 0600: $file" >&2
    exit 2
  fi
  local resolved
  resolved="$(realpath -e "$file")"
  if [[ "$resolved" != "$LOCAL_DIR/"* ]]; then
    echo "Credential files must resolve inside $LOCAL_DIR." >&2
    exit 2
  fi
  if ! git -C "$ROOT" check-ignore --quiet "$file"; then
    echo "Credential file is not ignored by Git: $file" >&2
    exit 2
  fi
}

require_origin() {
  local origin="${SAMVEV_E2E_ORIGIN:-}"
  if [[ -z "$origin" || "$origin" != "${SAMVEV_E2E_CONFIRM_ORIGIN:-}" ]]; then
    echo "SAMVEV_E2E_ORIGIN and SAMVEV_E2E_CONFIRM_ORIGIN must be non-empty and exactly equal." >&2
    exit 2
  fi
  if [[ ! "$origin" =~ ^https:// ]] && [[ ! "$origin" =~ ^http://(127\.0\.0\.1|localhost)(:|/|$) ]]; then
    echo "The confirmed origin must use HTTPS, except isolated loopback HTTP." >&2
    exit 2
  fi
  if [[ "$origin" == */ ]]; then
    echo "Origin must not have a trailing slash." >&2
    exit 2
  fi
}

require_enabled_runtime() {
  local status
  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --connect-timeout 10 --max-time 20 "${SAMVEV_E2E_ORIGIN}/api/v1/e2e/fixtures/weekly-plan")"
  if [[ "$status" != "200" ]]; then
    echo "The confirmed runtime does not expose the enabled synthetic live-E2E fixture (HTTP $status)." >&2
    exit 2
  fi
}

require_running_candidate() {
  local app_id candidate_image_id app_image_id
  app_id="$(compose ps --quiet app)"
  if [[ -z "$app_id" ]]; then
    echo "Expected one running samvev-m1 app container before provisioning." >&2
    exit 2
  fi
  candidate_image_id="$(docker image inspect --format '{{.Id}}' "$SAMVEV_E2E_RUNTIME_IMAGE")"
  app_image_id="$(docker inspect --format '{{.Image}}' "$app_id")"
  if [[ "$candidate_image_id" != "$app_image_id" ]]; then
    echo "Refusing provisioning: the running app does not use SAMVEV_E2E_RUNTIME_IMAGE." >&2
    exit 2
  fi
}

case "${1:-}" in
  provision)
    require_origin
    require_digest_image SAMVEV_E2E_RUNTIME_IMAGE
    require_running_candidate
    require_enabled_runtime
    if [[ -e "$CREDENTIALS_FILE" ]]; then
      require_safe_file "$CREDENTIALS_FILE"
    fi
    compose --profile live-e2e run --rm --no-deps live-e2e-provisioner npm run e2e:provision --workspace @samvev/api -- "$CONTAINER_CREDENTIALS_FILE"
    require_safe_file "$CREDENTIALS_FILE"
    ;;
  run)
    require_origin
    require_digest_image SAMVEV_E2E_HARNESS_IMAGE
    require_enabled_runtime
    require_safe_file "$CREDENTIALS_FILE"
    require_safe_file "$AI_SETTINGS_FILE"
    printf 'Report files on host: %s/<invocation>/report.json (invocation is printed by the runner)\n' "$REPORTS_DIR"
    SAMVEV_E2E_CREDENTIALS_FILE="$CONTAINER_CREDENTIALS_FILE" \
      SAMVEV_E2E_AI_FILE="$CONTAINER_AI_SETTINGS_FILE" \
      SAMVEV_E2E_PUBLIC_SOURCE_URL="${SAMVEV_E2E_PUBLIC_SOURCE_URL:-}" \
      SAMVEV_E2E_SCENARIOS="${SAMVEV_E2E_SCENARIOS:-}" \
      compose --profile live-e2e run --rm --no-deps live-e2e
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
