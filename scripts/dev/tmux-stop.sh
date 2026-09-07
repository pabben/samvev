#!/usr/bin/env bash
set -euo pipefail
if tmux has-session -t '=samvev-m1' 2>/dev/null; then
  tmux kill-session -t '=samvev-m1'
  echo "Stopped tmux session samvev-m1. Docker containers are unchanged."
else
  echo "samvev-m1 is not running."
fi
