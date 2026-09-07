#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
[[ "$ROOT" == /home/administrator/apper/samvev ]] || { echo "Unexpected repository root" >&2; exit 1; }
cd "$ROOT"
[[ "$(git branch --show-current)" == feat/m1-first-runnable-slice ]] || { echo "Expected M1 work branch" >&2; exit 1; }
[[ -f .codex/config.toml ]] || { echo "Missing project config" >&2; exit 1; }
# Astra was confirmed by a real read-only request during bootstrap.
# Only change to gpt-5.6-sol/xhigh after a real model-unavailable error, and document it.
PROMPT="$(< "$ROOT/prompts/m1-autonomous-with-agents.md")"
exec codex --strict-config -C "$ROOT" -m gpt-6-astra \
  -c 'model_reasoning_effort="xhigh"' \
  -c 'approvals_reviewer="auto_review"' \
  --sandbox workspace-write --ask-for-approval on-request --search "$PROMPT"
