#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
export SOURCE="$(pwd -P)" COMPOSE_IGNORE_ORPHANS=true
[[ "$(git -C "$SOURCE" rev-parse --show-toplevel)" == "$SOURCE" ]] || { echo 'proof source identity mismatch' >&2; exit 1; }
export SOURCE_HEAD_SHA="$(git -C "$SOURCE" rev-parse HEAD)"
if [[ -z "$(git -C "$SOURCE" status --porcelain --untracked-files=normal)" ]]; then export SOURCE_DIRTY=false; else export SOURCE_DIRTY=true; fi
[[ $# -le 1 && ( $# -eq 0 || "$1" == --screenshots ) ]] || { echo 'usage: run.sh [--screenshots]' >&2; exit 2; }
export VISUAL_DIR="$SOURCE/.local/m3/round17/visual"
mkdir -p "$VISUAL_DIR"
[[ ! -L "$VISUAL_DIR" && "$(realpath "$VISUAL_DIR")" == "$VISUAL_DIR" ]] || { echo 'visual output path must be a real directory in this checkout' >&2; exit 1; }
git -C "$SOURCE" check-ignore -q .local/m3/round17/visual || { echo 'visual output path is not ignored by git' >&2; exit 1; }
validate_visual_directory() {
  node --input-type=module - "$VISUAL_DIR" "$1" <<'NODE'
import { createHash } from 'node:crypto';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
const [dir, mode] = process.argv.slice(2);
const entries = await readdir(dir, { withFileTypes: true });
const names = entries.map(entry => entry.name).sort();
if (entries.some(entry => !entry.isFile())) throw new Error('visual output may contain only regular files; refusing to remove or traverse unknown entries');
const manifestPath = resolve(dir, 'manifest.json');
let manifest = null;
if (names.includes('manifest.json')) {
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch { throw new Error('existing manifest.json is unreadable; refusing to overwrite visual evidence'); }
  if (!Array.isArray(manifest.screenshots)) throw new Error('existing manifest lacks screenshot inventory; refusing to overwrite visual evidence');
}
const listed = manifest?.screenshots.map(item => item.file);
if (listed && (listed.some(file => typeof file !== 'string' || basename(file) !== file || !file.endsWith('.png')) || new Set(listed).size !== listed.length))
  throw new Error('manifest contains an invalid or duplicate screenshot filename');
if (mode === 'pre') {
  if (!manifest) {
    if (names.length) throw new Error(`visual output contains pre-existing unmanifested files: ${names.join(', ')}`);
    process.exit(0);
  }
  const expected = ['manifest.json', ...listed].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error(`visual output contains unmanifested or missing pre-existing files; found [${names.join(', ')}], expected [${expected.join(', ')}]`);
  for (const item of manifest.screenshots) {
    const path = resolve(dir, item.file), stat = await lstat(path);
    const bytes = await readFile(path);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (!stat.isFile() || item.sha256 !== digest) throw new Error(`pre-existing screenshot failed manifest hash verification: ${item.file}`);
  }
} else {
  if (!manifest) throw new Error('screenshot run did not write a valid manifest');
  const expected = ['manifest.json', ...listed].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error(`visual output contains files outside the manifest inventory; found [${names.join(', ')}], expected [${expected.join(', ')}]`);
  for (const item of manifest.screenshots) {
    const path = resolve(dir, item.file), stat = await lstat(path);
    const bytes = await readFile(path);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (!stat.isFile() || item.sha256 !== digest) throw new Error(`screenshot failed manifest hash verification: ${item.file}`);
  }
}
NODE
}
validate_visual_directory pre
probe=$(mktemp "$VISUAL_DIR/.write-check.XXXXXX")
rm -f "$probe"
if [[ "${1:-}" == --screenshots ]]; then export SCREENSHOT_MODE=1; else export SCREENSHOT_MODE=0; fi
export PROOF_ID="$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
export LANDSCAPE_FILENAME=".synthetic-landscape-$PROOF_ID.webp"
export SYNTHETIC_LANDSCAPE_PATH="/visual/$LANDSCAPE_FILENAME"
db="samvev-m1-display-proof-db-$PROOF_ID"
api="samvev-m1-display-proof-api-$PROOF_ID"
browser="samvev-m1-display-proof-browser-$PROOF_ID"
network="samvev-m1-display-proof-$PROOF_ID"
compose=(docker compose --env-file /dev/null -p samvev-m1 -f tests/e2e/display-proof/compose.yaml)
for name in "$db" "$api" "$browser"; do if docker inspect "$name" >/dev/null 2>&1; then exit 1; fi; done
if docker network inspect "$network" >/dev/null 2>&1; then exit 1; fi
cleanup() {
  rm -f "$VISUAL_DIR/$LANDSCAPE_FILENAME"
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
docker exec -e LANDSCAPE_SOURCE=/source/apps/web/src/assets/nordic-dusk-v2.png -e LANDSCAPE_TARGET="$SYNTHETIC_LANDSCAPE_PATH" "$api" node --input-type=module -e 'import sharp from "sharp";import {readFile,writeFile} from "node:fs/promises";const output=await sharp(await readFile(process.env.LANDSCAPE_SOURCE)).resize({width:1200,height:480,fit:"cover"}).webp({quality:82}).toBuffer();await writeFile(process.env.LANDSCAPE_TARGET,output);'
[[ -s "$VISUAL_DIR/$LANDSCAPE_FILENAME" ]] || { echo 'isolated API did not create the synthetic landscape in the visual bind' >&2; exit 1; }
"${compose[@]}" run --rm --no-deps --name "$browser" proof-browser
if [[ "$SCREENSHOT_MODE" == 1 ]]; then
  [[ -f "$VISUAL_DIR/manifest.json" ]] || { echo 'visual proof did not write its manifest through the bind mount' >&2; exit 1; }
  count=$(find "$VISUAL_DIR" -maxdepth 1 -type f -name '*.png' | wc -l)
  [[ "$count" -eq 45 ]] || { echo "expected 37 display captures, 6 synthetic calendar captures and 2 simulated error UI captures, found $count PNGs" >&2; exit 1; }
  rm -f "$VISUAL_DIR/$LANDSCAPE_FILENAME"
  validate_visual_directory post
fi
