# M3 Family Hub — local development status

Branch: `feat/m3-family-hub`. No PR, push, merge, release, deploy or Actions run.

Implementation and initial browser QA are complete. Independent review and
expanded complete QA are in progress; this is not yet a final acceptance claim.

## Implemented

- [ADR 0020](../decisions/0020-external-intelligence-family-hub.md): stable connections, scoped hashed credentials, strict generic items and independent member/display disclosure.
- Additive migration 017, without old migration rewrites or message conversion.
- Six kinds: reminder, alert, event, summary, list and observation.
- Canonical idempotency, revision CAS, connection-scoped reads and permanent tombstones.
- Primary Home, target-person columns, Today/Tomorrow, Important, summaries/lists and family messages.
- Member/display SSE, polling and bounded offline expiry; message ACK preserved.
- Warm light/navy dark/system tokens, responsive mobile/iPad/TV/Shelly views.
- [15 screenshots and visual refinements](artifacts/m3/README.md).
- [API contract](M3_API.md), synthetic JSON/YAML and [future validation issue](../backlog/M3_INTEGRATION_VALIDATION.md).

## Evidence so far

- Baseline: 170/170 workspace tests.
- Backend checkpoint: 175/175 workspace tests; coordinator independently reran 149/149 API tests after final hardening.
- Frontend: 22/22 tests, check/build, nine M3 browser groups including ten viewport/theme Axe combinations, real SSE mutation/withdrawal, credential UI, dynamic people, offline expiry and render ACK.
- Independent fresh 001–017/rerun and upgrade 016→017 preserving synthetic legacy message IDs/bodies.
- UX review passes after screenshot-based refinements. Security/requirements follow-ups and expanded final QA are pending.

## Local checkpoints

- `bae2ac1`: external intelligence backend and contract.
- `16e897d`: family hub, semantic themes, cache/presentation tests.
- `10d7379`: real browser coverage and screenshots.

All use DCO sign-off. Pre-existing `.npmrc` edits and the empty untracked
`database` file are preserved outside these commits.

## Boundaries and rollback

Only synthetic data and local dev credentials are used. No real HA/OpenAI/Homey,
calendar, weather, push, live database or production secret was introduced.
Fonts use the existing system stack; scenery is CSS. Provenance is a producer
claim, not verification by Samvev. Stop ingress before reverting app/worker code;
retain additive tables and tombstones. A complete DB rollback requires a verified
pre-migration backup. No destructive down migration is supplied.

Physical Shelly and subjective visual preferences remain unvalidated. Long and
secondary content scrolls rather than being clipped. PR/release requires a new
explicit instruction. Disk baseline: filesystem 15 GiB used / 77 GiB available;
repository 47 MiB. Final measurements will follow QA.
