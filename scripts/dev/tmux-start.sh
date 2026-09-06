#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
[[ "$ROOT" == /home/administrator/apper/samvev ]] || exit 1
cd "$ROOT"
command -v tmux >/dev/null || { echo "tmux is missing; install manually." >&2; exit 1; }
if tmux has-session -t '=samvev-m1' 2>/dev/null; then
  echo "samvev-m1 already exists; no additional Codex started."
  exit 0
fi
mkdir -p "$ROOT/logs"
# Create an idle pane first so logging is active before Codex starts.
tmux new-session -d -s samvev-m1 -n codex -c "$ROOT" -x 160 -y 48
tmux set-option -t '=samvev-m1' remain-on-exit on
printf -v LOG_COMMAND 'cat >> %q' "$ROOT/logs/codex-m1.log"
tmux pipe-pane -o -t samvev-m1:codex "$LOG_COMMAND"
for WINDOW in app tests logs git; do
  tmux new-window -d -t samvev-m1 -n "$WINDOW" -c "$ROOT"
done
printf -v START_COMMAND 'exec %q' "$ROOT/scripts/dev/start-codex-m1.sh"
tmux send-keys -t samvev-m1:codex -l "$START_COMMAND"
tmux send-keys -t samvev-m1:codex Enter
echo "Started samvev-m1; attach with: tmux attach -t samvev-m1"
