# Final frontend fixes and UX evidence

All people, messages and accounts in these artifacts are synthetic. No cookies,
verifiers, authentication state or traces are saved. These are review candidates,
not approved visual regression baselines. No QA candidate/mask/baseline changed.

## Verified fixes

- F7: People shows active, disabled, profile-only and undisclosed account status
  accurately, with a checkmark only for explicitly active sign-in; en and nb.
- F8: PersonEditor filters unavailable historical display grants once on opening.
  It preserves later selections so concurrent revocation produces the real server
  error, retaining the form. The first runtime execution saved the original Robin
  with one active grant retained and three revoked historical grants removed.
  Subsequent runs make an owned temporary historical grant to reproduce this on
  fresh QA. They preserve every unrelated active grant and role/capability.
- F9: Native dialogs wrap Tab/Shift+Tab at the first/last enabled visible control.
  Native dialog semantics and Escape are retained; closing restores the opener.

## Execution

Workspace `npm run check`, web `npm run test --workspace @samvev/web` (10/10) and
`npm run build` passed in the labeled tools service after production fixes.

`ux-qa/ux-results.json` is the authoritative complete UX run: `completed:true`,
`phase:all`, `baseURL:http://qa-app:4173`, 10 passing checks and 17 screenshots.
It includes actual pairing, permission mutations, two original message authors,
privacy and revocation. Explicit test-only response variants/faults cover account
status disclosure, held loading requests and HTTP503 errors. Cleanup withdrew its
2 messages, revoked its 3 displays and removed its temporary grants. Runtime and
QA installations were not reset. The coordinator authorized the isolated qa-app
execution while the runtime pairing bucket naturally remained limited.

`ux/` is superseded partial runtime development evidence (`completed:false`).
`components-debug/` is a successful components-only debug run, not full acceptance.
Completion timestamps for these initial manifests and the final UX manifest were
backfilled from their actual file completion mtime; the runner now writes
`executedAt` and `baseURL` automatically on every execution.

The exact `bash scripts/m1.sh browser-test` was attempted after the fixes. Reduced
motion, unchanged People Axe and required fixture-profile checks passed, then the
runtime displayed the real pairing rate-limit error. `failure-display.png` is
failure evidence, not an accepted visual candidate. No full smoke or focused
regression pass is claimed for this attempt. QA must replay that exact command
when the normal window expires. The API does not currently include Retry-After;
the harness now records sanitized status/code/header diagnostics on failed start.

Smoke preserves the same four required profile names and all role/login/grant
checks. A fresh installation still requires exactly four total people; a reused
installation permits additional profiles but requires each fixed profile exactly
once. The newly approved display is selected by its returned ID. It never chooses
the last display in a list that may include revoked history. Existing timestamp
Range masks, rendered-time checks, reduced-motion and Axe rules remain intact.
Smoke/focused default output now targets this directory to retain older evidence.

## Reproduce UX runner

After the normal synthetic onboarding/smoke fixtures exist:

```bash
docker compose --project-directory /home/administrator/apper/samvev \
  --env-file .env.example -p samvev-m1 -f compose.yaml --profile browser \
  run --rm --no-deps -e BASE_URL=http://qa-app:4173 \
  -e UX_ARTIFACT_DIR=docs/implementation/artifacts/frontend-final/ux-qa \
  browser node apps/web/tests/ux-states.mjs
```

For runtime use `BASE_URL=http://samvev-m1-app-1:4173` and a distinct artifact
directory. `UX_PHASE=components` runs only loading/error/workbench diagnostics;
omit it for complete UX acceptance. Each full run consumes up to three real
pairing starts. Respect durable rate limits; do not reset their buckets.

The screenshot manifest includes file, viewport, capture scope and asserted state.
It covers fresh empty, real concurrent-permission error, four account states in
en/nb, visible tab focus, mobile lower controls and retained draft error, expanded
long/unbroken nb content, Shelly two-person columns, real privacy/revocation,
loading/error retry, and three responsive workbench captures. These supplement
the existing 12-image populated display matrix; they do not replace that matrix.
