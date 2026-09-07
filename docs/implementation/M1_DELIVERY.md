# M1 local delivery

Verified 2026-09-07 UTC. **Local acceptance passed; reported Git delivery is
not remotely verified.**
The final independent [release gate](M1_RELEASE_GATE.md) returned **BLOCKED
solely for Git delivery**, with local M1 acceptance **PASS** and no additional
confirmed high- or medium-severity local finding.
The subsequent read-only Git/PR checks still show the previous remote commit
and no PR; the release gate therefore remains BLOCKED.

## Runtime and review entry points

- Member/setup: <http://127.0.0.1:4173>
- Restricted display: <http://127.0.0.1:4173/display>
- Component workbench: <http://127.0.0.1:4173/workbench>
- [Synthetic accounts, pairing and accelerated demonstration](M1_DEMO.md)
- [Operations, reset, troubleshooting and rollback](M1_OPERATIONS.md)
- [Complete QA evidence](M1_QA.md)
- [Coordinator verification](artifacts/coordinator/final-verification.json)

Only port 4173 is published, on loopback. The `samvev-m1` app, database and
worker are healthy; the isolated QA stack is also healthy. Runtime versions
were independently checked: Node 24.20.0 in app and worker, PostgreSQL 17.11.
The runtime contains five fictional people, four applied migrations and one
active test display, `d6ccec43-19d8-4a3f-b02c-5eb30687bf61`.

Root revoked exactly four abandoned synthetic display credentials through the
scoped API after the final replay. No installation reset or history deletion
was performed. The extra fifth profile is retained control-run data, not an
extra person required by M1.

## Implementation and files

[ADR 0011](../decisions/0011-typescript-m1-postgresql-scheduler.md) selects a
TypeScript monorepo: React/Vite member and display UI, a same-origin Fastify API,
PostgreSQL durable state and a separate scheduler/expiry worker. Scheduling and
delivery are transactional and idempotent; bounded SSE fan-out uses one dedicated
database listener with truthful degradation and polling recovery.

| Files / services | Delivered behavior |
|---|---|
| `apps/web/`, `packages/design-tokens/` | Resumable setup, people/roles, composer, preferences, restricted display, safe offline cache, workbench, en/nb, responsive light/dark/system UI |
| `services/api/`, four SQL migrations | Authentication, server-side permissions and household isolation, pairing/revocation, message lifecycle, projection/render ACK, audit activity and rate limits |
| `services/worker/` | Restart-safe scheduling, missed-window handling, automatic expiry |
| `packages/core/`, `packages/contracts/` | Permission/lifecycle rules and typed contracts |
| `Dockerfile`, `compose.yaml`, `.env.example`, `.dockerignore`, `.npmrc`, `scripts/m1.sh` | Project-scoped runtime/tool/test stacks and local commands |
| `package.json`, `package-lock.json`, `tsconfig.json`, workspace manifests | Pinned dependencies and workspace commands |
| `apps/web/tests/`, `services/api/src/*.test.ts`, `packages/core/src/*.test.ts`, `tests/e2e/` | Behavior, migration, browser, accessibility and visual regression tests |
| `README.md`, `README.nb.md`, `docs/decisions/`, `docs/implementation/`, `.gitignore` | Architecture, evidence, checklist, demo and delivery documentation |

## Executed acceptance

- `bash scripts/m1.sh qa-test`: **exit 0**. Fresh demo and a second fresh
  installation; 17 smoke, 10 focused and 10 UX checks; actual 45-second worker
  stop/restart; all 12 ordinary visual comparisons passed.
- `bash scripts/m1.sh browser-test`: **exit 0**, 16 runtime smoke and 10 focused
  checks using the original named fixture, including the previously failing
  revoked-grant edit flow.
- `bash scripts/m1.sh test`: **18 passed, 0 failed/skipped**. Ten web, three
  core and five PostgreSQL API scenarios. Coordinator independently reran it;
  [raw output](artifacts/coordinator/unit-integration.log). Contracts and worker
  have no standalone tests; their behavior is covered by integration/acceptance.
- Workspace TypeScript checks, production build, shell syntax, Compose validation
  and whitespace checks passed. Full dependency audit reports zero vulnerabilities.
  The existing `lint` dispatcher is not substantive lint coverage.
- Coordinator independently verified both persisted restart ledgers, runtime
  health and current JS/CSS assets, unauthenticated 401 guards, original baseline
  hashes and dimensions, all twelve zero-difference results, and 168 rendered
  temporal assertions across separate live and screenshot contexts.
- A modified/new-file secret-pattern scan and structured artifact-auth-field
  scan passed. Only reserved synthetic email domains were found.

Restart ledger: `adebfd5d-2c8c-4f45-88ed-1e03cc507d80` has exactly
`scheduled → expired`; `7a13c352-db6d-4b96-9f25-b5d27699c340` has exactly
`scheduled → published → expired`.

## Screenshots and visual limits

- [Phone, Norwegian light](artifacts/qa-final/display-mobile-nb-light.png)
- [16:9 shared display, English light](artifacts/qa-final/display-shared-en-light.png)
- [Shelly XL 1280×752, Norwegian dark](artifacts/qa-final/display-shelly-xl-nb-dark.png)
- [Two-author Person Columns](artifacts/qa-final/ux/shelly-person-columns-nb-dark.png)
- [Retained mobile draft after error](artifacts/qa-final/ux/mobile-composer-retained-error.png)
- [Seventeen UX-state captures](artifacts/qa-final/ux/ux-results.json)
- [All twelve visual comparison results](artifacts/qa-final/visual-comparison.json)

The screenshot page alone fixes its client calendar/clock to
`2026-09-07T02:45:00Z`; card/footer timestamps, restricted API, SSE and worker
remain real. Both live and captured-page temporal text are asserted separately.
The original twelve baseline images are unchanged. Only four explicitly reviewed
Norwegian clock masks gained one right-edge raster pixel. No percentage tolerance,
broad label masking, automatic baseline replacement or skipped rule was used.
Matching the approved one-page capture sequence eliminated a small border
difference in the diagnostic and complete replay; its exact raster cause was
not established.

## Migration, rollback and remaining limits

Migrations 001–004 are ordered and checksum tracked. Reapplication and corrupted
checksum rejection were executed. Migration 004 adds only a rate-limit cleanup
index; migrations 001–003 were unchanged during remediation. There is no automatic
down migration. For retained data, restore a verified logical backup before
returning to an earlier schema/application combination. The pre-upgrade synthetic
backup is ignored under `.local/backups`; its checksum/structure were checked,
but an actual restore was not exercised.

Physical iPhone and Shelly hardware were not tested; the required browser sizes
were visually checked. This is a local, loopback-bound M1, with no production
deployment. AI, Homey, Home Assistant, calendars, Spond, Keep, native iOS, rewards
and voice remain deferred. The next product issue should validate the pilot on
actual devices and record usability feedback before expanding integrations.

## Git delivery verification — 2026-09-07 UTC

Branch: `feat/m1-first-runnable-slice`. Observed remote tip and sandbox HEAD:
`5bd4f0416efb3eaeb88a34e456d1f075de463ac9`.

The user reported completing commit, push and draft PR from a normal host shell.
However, `git ls-remote` and GitHub's branch-ref and commit APIs still show the
existing tmux-fix commit, dated `2026-09-06T22:43:09Z`. `gh pr list` returns no
PRs with or without branch/base filters, and the REST pull-request listing is
also empty. Repository identity is confirmed as `pabben/samvev`, base `main`.
**A pushed implementation commit and draft PR could not be verified; PASS is
not justified by these results.** See the [exact release-gate checks](M1_RELEASE_GATE.md).

The earlier sandbox attempt failed at `.git/index.lock` on a read-only
filesystem. This follow-up made no commit attempt or Git metadata change.
The existing [PR title/body file](M1_PR_DRAFT.md) is preparation, not evidence
that a remote PR exists. A PR URL was requested to reconcile the discrepancy.

Only M1_RELEASE_GATE.md, M1_DELIVERY.md and M1_STATUS.md were updated in this
follow-up. No application behavior, tests, runtime data or migration changed;
prior acceptance evidence remains applicable and was not rerun. No secret/private
family data, parent/sibling project change, host-global change, main push,
merge, tag, release or production deploy was made.
