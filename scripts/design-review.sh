#!/usr/bin/env bash
# Capture the proven synthetic QA runtime into an ignored stage, then let the
# host verify and atomically publish exactly fourteen screenshots.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$ROOT" == "/home/administrator/apper/samvev" ]] || { echo "Unexpected repository root: $ROOT" >&2; exit 2; }
cd "$ROOT"
mkdir -p .local/design-review
exec 9>.local/design-review/operation.lock
flock -n 9 || { echo 'Another design-review operation is running.' >&2; exit 2; }

proof="$(node scripts/design-review-provenance.mjs verify)"
readarray -t fields < <(node -e 'const p=JSON.parse(process.argv[1]); for(const v of [p.sourceSha,String(p.workingTreeDirty),p.runtime.after.app.publicOrigin]) console.log(v)' "$proof")
source_sha="${fields[0]}"
working_tree_dirty="${fields[1]}"
base_url="${fields[2]}"
[[ "$source_sha" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid source SHA.' >&2; exit 2; }
[[ "$working_tree_dirty" == true || "$working_tree_dirty" == false ]] || { echo 'Invalid working-tree state.' >&2; exit 2; }
[[ "$base_url" == http://192.168.0.220:4173 ]] || { echo "Refusing non-LAN QA public origin: $base_url" >&2; exit 2; }

stage_name="capture-$(date -u +%Y%m%d%H%M%S)-${source_sha:0:8}-$$"
stage_path="$ROOT/.local/design-review/$stage_name"
cleanup() { rm -rf -- "$stage_path"; }
trap cleanup EXIT

docker compose --project-directory "$ROOT" --env-file "$ROOT/.env.example" -p samvev-m1 -f "$ROOT/compose.yaml" --profile qa \
  run --rm --no-deps \
  -e DESIGN_REVIEW_SOURCE_SHA="$source_sha" \
  -e DESIGN_REVIEW_WORKING_TREE_DIRTY="$working_tree_dirty" \
  -e DESIGN_REVIEW_PROOF_PATH=.local/design-review/build-provenance.json \
  -e DESIGN_REVIEW_STAGE_PATH=".local/design-review/$stage_name" \
  -e DESIGN_REVIEW_BASE_URL="$base_url" \
  qa-browser node scripts/design-review.mjs

node scripts/design-review-publication.mjs finalize "$stage_path"
trap - EXIT
echo "Published fourteen host-verified screenshots for source $source_sha."
