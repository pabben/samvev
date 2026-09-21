#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
[[ "$ROOT" == /home/administrator/apper/samvev ]] || exit 1
cd "$ROOT"
if command -v tmux >/dev/null && tmux has-session -t '=samvev-m1' 2>/dev/null; then
  echo "samvev-m1: running"
  tmux list-windows -t '=samvev-m1'
  tmux capture-pane -pt samvev-m1:codex -S -40 | tail -n 40
else
  echo "samvev-m1: not running"
fi
git status --short --branch
COMPOSE_FILE=""
for CANDIDATE in compose.yaml compose.yml docker-compose.yaml docker-compose.yml infra/compose/compose.yaml infra/compose/compose.yml infra/compose/docker-compose.yml; do
  if [[ -f "$CANDIDATE" ]]; then COMPOSE_FILE="$CANDIDATE"; break; fi
done
if [[ -n "$COMPOSE_FILE" ]]; then
  docker compose --project-directory "$ROOT" -p samvev-m1 -f "$COMPOSE_FILE" ps
else
  echo "No Samvev Compose file yet."
fi
