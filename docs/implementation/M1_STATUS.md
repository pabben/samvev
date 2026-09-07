# M1 implementation status

Updated: 2026-09-07. Branch: `feat/m1-first-runnable-slice`.
Overall status: **PASS — local acceptance passed; Git delivery externally verified and sole blocker resolved**.

Current delivery and demo: [M1_DELIVERY.md](M1_DELIVERY.md),
[M1_DEMO.md](M1_DEMO.md). The gate table and **Final execution and independent
verification** section describe the current state. All later checkpoint
sections record earlier states and counts.

## Gate progress

| Gate | Status | Evidence |
|---|---|---|
| A: parallel discovery | Complete | All four named agents returned read-only reports; M1_DISCOVERY.md |
| B: coordinator plan and ADR | Complete | M1_DISCOVERY.md, M1_PLAN.md, M1_FIRST_SLICE.md, ADR 0011 |
| C: sequential implementation | Complete; initial QA failures resolved in Gate E | M1_QA.md |
| D: parallel review | Complete; findings resolved | All three reports and rechecks returned; M1_REVIEW_FINDINGS.md |
| E: fixes, full retest, release gate | PASS; sole Git blocker resolved | [Final release review](M1_RELEASE_GATE.md); prior complete QA and independent verification passed; external GitHub delivery confirmation closes the remaining blocker |
| Push and draft PR | Complete; externally verified by the user | [Draft PR #1](https://github.com/pabben/samvev/pull/1), remote head `5e1f384cf8b4322454ea5a200ae457db6738b764`; open, draft, mergeable; Documentation checks success |

## Git delivery resolved — 2026-09-07 UTC

The user supplied direct GitHub confirmation of [PR #1](https://github.com/pabben/samvev/pull/1)
on `feat/m1-first-runnable-slice`, remote head
`5e1f384cf8b4322454ea5a200ae457db6738b764`. The PR is open, draft and mergeable;
GitHub Documentation checks succeeded. Git was the only remaining blocking
finding, so the release gate changes from BLOCKED to **PASS**.

This status uses the user's external verification and the existing local
acceptance evidence. Codex did not rerun GitHub checks or application tests
for this update. Only M1_RELEASE_GATE.md, M1_DELIVERY.md and M1_STATUS.md are
changed; no application/test changes, test execution, merge, commit or push.
The sandbox's read-only Git restriction remains in place. Historical checklist
and JSON snapshots are unchanged under the explicit three-document scope.

## Historical Git delivery follow-up — resolved

The user reported a completed implementation commit, work-branch push and draft
PR from the host shell. Read-only verification did not confirm the report:

- `git ls-remote` and GitHub's branch-ref API agreed on the old work-branch SHA
  `5bd4f0416efb3eaeb88a34e456d1f075de463ac9`; main remained
  `f82dd8208c0a169a21226fe4af81fb7e9dc62d09`.
- GitHub's commit API identified the same signed-off tmux-fix commit from
  `2026-09-06T22:43:09Z`, not an implementation commit. A local tree read of
  that exact object contained none of the queried implementation paths.
- Repository identity was `pabben/samvev`, default branch `main`. Both filtered
  and unfiltered `gh pr list --state all` calls returned `[]`; a separate REST
  pull-request listing also returned `[]`.
- Commands succeeded, but the expected new remote commit and draft PR were
  not found. Release gate then remained BLOCKED; local acceptance remained PASS.
  A PR URL was requested to reconcile the host-shell report.
- Only M1_RELEASE_GATE.md, M1_DELIVERY.md and M1_STATUS.md were updated. No
  application changes, test rerun, commit attempt, push, fetch or merge.

Historical commands/results: [M1_RELEASE_GATE.md](M1_RELEASE_GATE.md). These
observations are superseded by the external GitHub confirmation above;
the previous delivery discrepancy is resolved.

## Executed checks

- Required-document and ADR reads: complete; no missing required files.
- Branch/worktree: correct requested branch, initially clean.
- Bootstrap-artifact tracked path check: no matching files.
- Docker Compose version and exact project-label container query: successful.
- Host Node: absent; all JavaScript tooling will be container-local.
- Git remote read and GitHub authenticated read: successful.
- Backend tests, migration replay, browser screenshots and actual process restart
  executed. Final complete acceptance command passed; see M1_QA.md.

## Final execution and independent verification

- `qa-test` exited 0: fresh demo, second fresh owner setup, 17 smoke checks,
  10 focused regressions, 10 UX checks, real 45-second worker stop/restart and
  12 ordinary visual comparisons, each with zero outside-mask changes.
- `browser-test` exited 0: 16 runtime smoke and 10 focused checks. The genuine
  pairing rate-limit failure is superseded by this successful natural-window
  replay. No limiter reset or weakened assertion was used.
- Eighteen tests pass: web ten, core three, API five; zero failures/skips.
  Coordinator independently reran the full suite. TypeScript, production build,
  full dependency audit (zero vulnerabilities), shell/Compose and whitespace
  checks pass. Pattern and structured artifact-auth-field scans pass.
- Coordinator independently queried the final QA ledger: missed ID
  `adebfd5d-2c8c-4f45-88ed-1e03cc507d80` has exactly scheduled→expired;
  recovery ID `7a13c352-db6d-4b96-9f25-b5d27699c340` has exactly
  scheduled→published→expired. No missed-window or duplicate publication exists.
- Root verified all twelve image hashes/dimensions, unchanged original baseline
  images, precisely four reviewed one-pixel clock-mask corrections, and 168
  matching rendered temporal assertions across live and screenshot contexts.
  Only the screenshot client's calendar/clock is fixed; API, SSE, card/footer
  timestamps, worker, expiry and restart remain real.
- Security recheck found no remaining high/medium findings; final UX accepted
  F7–F9 and all seventeen difficult-state screenshots. The final release reviewer
  independently confirmed local acceptance and found no additional high/medium
  local defect. Git was the sole remaining blocker and is now resolved by
  the user's external GitHub confirmation; the overall gate is PASS.
- Main and QA app/database/worker are healthy. Node 24.20.0 and PostgreSQL 17.11
  verified directly. Runtime has five fictional people, four migrations and one
  dedicated projection listener. Current routes and JS/CSS return 200; anonymous
  member/projection APIs return 401.
- Current active test display: `d6ccec43-19d8-4a3f-b02c-5eb30687bf61`.
  Root revoked exactly four known abandoned synthetic display credentials after
  the final replay. One display remains active; the fifth control profile and
  history remain. No runtime reset/history deletion occurred.
- Evidence: [coordinator verification](artifacts/coordinator/final-verification.json),
  [independent tests](artifacts/coordinator/unit-integration.log),
  [final visual comparison](artifacts/qa-final/visual-comparison.json),
  M1_QA.md and M1_DELIVERY.md. Current external Git delivery evidence is
  [PR #1](https://github.com/pabben/samvev/pull/1), remote head
  `5e1f384cf8b4322454ea5a200ae457db6738b764`, supplied by the user.

## Historical Gate C: devops checkpoint

- Compose configuration, shell syntax and `git diff --check`: passed.
- Project-labeled tool container generated npm lockfile v3; dependency install
  completed. Node v24.14.0 and npm 11.9.0 available without host installation.
- Coordinator independently observed `samvev-m1-dependencies-1` exited 0 and
  `samvev-m1-db-1` healthy using exact project-label queries.
- Built workspace image and writable project dependency volume verified by
  devops. Foundation command dispatch is not application test evidence.
- Initial Chromium image build timed out; frontend subsequently completed the
  image build and both frontend and QA executed real Chromium browser tests.
- Buildx initially failed writing activity metadata outside the workspace.
  Supported `BUILDX_CONFIG` now confines tool state to ignored `.local/buildx`;
  no host configuration or permissions were changed.

## Historical Gate C: backend checkpoint and independent verification

- Implemented contracts/core, Fastify API, PostgreSQL schema/migrations, separate
  worker, role/target permissions, pairing, message lifecycle, SSE/projection/ACK,
  resumable claim and explicit persisted synthetic demo. Contract: M1_API.md.
- Backend agent ran TypeScript checks for all four workspaces successfully.
- Coordinator independently ran `bash scripts/m1.sh test`: exit 0, **2 core unit
  tests + 3 PostgreSQL integration scenarios passed, zero failures/skips**.
  Contracts and worker scripts currently contain zero standalone tests; their
  behavior is covered by core/API integration scenarios, not additional counts.
- Integration scenarios include claim/redeem races, multiple no-login people,
  CSRF and role denial, owner protection, limited display targets, cross-household
  isolation, optimistic edit, duplicate ACK, privacy/revocation, honest delivery,
  scheduling/catch-up/expiry/withdrawal, starvation resistance, migration rerun
  and persisted synthetic demo. Actual worker restart remains a QA requirement.
- Backend production dependency audit initially found high advisories; affected
  packages were updated (Fastify 5.12.3, static 10.1.3). Backend rerun reported
  zero vulnerabilities. Full dependency scan after frontend remains pending.
- Coordinator observed app/worker/db healthy and migration/dependency containers
  exited 0. Independent HTTP health response: `{"status":"ok","version":1}`.
- Independent setup status: unclaimed, welcome, demo false; runtime is ready for
  the frontend's first-run flow. Test fixtures live in isolated `samvev_test`.
- `git diff --check` passed. Ordered migrations 001–003 applied at this stage.

## Historical Gate C: frontend checkpoint

- Implemented `/` (setup/member), `/display` (restricted client) and `/workbench`
  with Nordic tokens, en/nb, light/dark/system, people/permissions, composer,
  lifecycle/delivery, pairing and safe offline display behavior.
- Final frontend TypeScript check, four timezone/cache unit tests and production
  build passed. Frontend production dependency audit reported zero vulnerabilities.
- Chromium image completed successfully using project-local labeled Docker tooling.
- Initial real browser smoke passed setup/resume, four people, limited login and
  grants, pairing, immediate live display/ACK, tomorrow-07:00 schedule/edit/withdraw,
  real accelerated automatic publication/expiry, offline/reconnect and persisted
  member nb/dark preferences. Evidence: `artifacts/frontend/README.md` and
  `artifacts/frontend/initial-smoke-results.json`.
- Twenty initial passing screenshots include all 12 size/locale/theme display
  combinations. Coordinator personally viewed Shelly dark, shared 16:9 light,
  mobile nb dark and People screenshots. These are initial visual evidence,
  not final visual regression or physical hardware certification.
- A later smoke replay stopped on a navigation accessible-name mismatch caused
  by its message count. The localized accessible label was corrected; full
  post-fix browser replay is pending QA. Superseded failure captures are excluded
  from passing evidence in the artifact README.
- Synthetic runtime is now claimed with `owner@pilot.invalid` and
  `limited@pilot.invalid`, password `Synthetic-pilot-pass-42`, four fictional
  people and a paired Kitchen example display. No private household data used.
- Known backend fix: restricted projection needs household timezone. Frontend
  expects `display.timezone` and visibly labels its temporary UTC fallback.
  Coordinator has queued additional scoped ACK, administrator-lockout and SSE
  resource-limit review cases for Gate D/E. No full release PASS is claimed.

## Historical Gate C: qa checkpoint and pending review

- QA was the sole fourth writer. Added isolated `qa-db`, `qa-app`, `qa-worker`,
  `qa-browser`, a separate project-labeled volume, `bash scripts/m1.sh qa-test`,
  acceptance/restart/accessibility/visual harnesses and M1_QA.md.
- Nine unit/integration tests passed (four web, two core, three PostgreSQL API),
  with no skips/todos. Typecheck, production build, Compose/shell validation and
  secret/private-data pattern scans passed.
- Fresh UI workflow and 12 captures passed before the final preference reload
  assertion failed. The assertion reloads while the theme save may be in flight;
  no visible completion signal exists. Exact cause and rapid-change behavior
  need frontend review; the failed evidence is retained.
- Explicit fresh-install synthetic demo passed. An actual scoped worker restart
  proved catch-up publication, missed-window expiry and later expiry. The added
  lifecycle-ledger assertions have not yet executed in the complete sequence.
- Axe 4.13.0 found three serious contrast nodes. Full npm audit found two high
  Playwright entries. Persistent visual comparison failed at 53.61%; baseline
  refresh requires diagnosis and visual review, not automatic acceptance.
- Coordinator independently read QA results, viewed a Norwegian Shelly screenshot,
  checked current Compose configuration and confirmed healthy runtime containers.
- Coordinator also found removed display targets can be requeued by body-only
  edits; queued scope/lockout/SSE/timezone/priority checks go to Gate D/E.
- Official Node/PostgreSQL security advisories show current image pins predate
  patches. Devops image and Playwright updates are queued for Gate E, with full
  retest after changes. No release PASS or completed Git delivery is claimed.

## Gate E infrastructure checkpoint

- D1/D2/D3 addressed. Evidence: `artifacts/devops/2026-09-07-infrastructure-remediation.md`.
- Node 24.20.0, PostgreSQL 17.11 and Playwright 1.63.0 are installed in the
  scoped runtime/tooling images. Forced browser rebuild and Chromium launch passed.
- Full dependency audit reports zero vulnerabilities; all current nine tests,
  migrations, typecheck and build passed. No complete browser acceptance PASS yet.
- Coordinator independently executed runtime version queries: Node v24.20.0,
  PostgreSQL 17.11; retained runtime data has four persons and three migrations.
  Independent HTTP health was OK. Pre-upgrade synthetic SQL backup is ignored
  under `.local/backups`; evidence records checksum/size and limited validation.
- QA cleanup discovers only project-labeled volumes, verifies the exact name
  before deletion, fails on cleanup errors, and verifies a newly created volume
  before starting its database. Shell/Compose/whitespace validation passed;
  full clean-install execution of the corrected helper is pending final QA.
- Infrastructure writer released the slot. Backend completed the next sequential turn.

## Gate E backend checkpoint

- B1–B10 implemented; contract and exact event payloads are in M1_API.md.
  Removed targets remain terminal, ACK locking is scoped, active-account owner
  protection and separate account-management authorization are enforced.
- One dedicated PostgreSQL listener serves bounded SSE streams. Ready/heartbeat
  describe listener availability; degraded/restored events require truthful UI
  state and a fresh projection before claiming Live. Transient database errors
  do not falsely report credential revocation.
- Backend executed **11 tests: four web, three core, four PostgreSQL API
  scenarios; zero failures or skips**, plus all-workspace typecheck/build,
  full dependency audit (zero vulnerabilities) and whitespace checks.
- The regression suite includes ten concurrent streams with normal API requests,
  a real isolated notification-listener termination and reconnection, a new
  subscription during that outage, foreign-row-lock ACK isolation, effective
  administrator transfer, login verification/rate limits, narrow activity,
  timezone, attention ordering and the hard 15-minute cache deadline.
- Coordinator independently observed runtime health OK, four retained persons,
  four migration ledger rows and exactly one dedicated listener. Coordinator's
  independent `bash scripts/m1.sh test` replay exited 0 with the same 11 passing
  tests and zero failures/skips/todos before frontend handoff.
- Additive migration 004 adds the rate-limit cleanup index. Applied migrations
  001–003 were unchanged; runtime app/database/worker are healthy after restart.
- Frontend must consume safe edit/withdraw activity, timezone, hard projection
  TTL and the finalized listener-degradation contract. Complete browser QA and
  reviewed visual baselines remain pending; no overall acceptance PASS claimed.

## Gate E frontend checkpoint

- F1–F7 implemented. Evidence and candidate index:
  [frontend-candidates/README.md](artifacts/frontend-candidates/README.md).
- Eight frontend units, TypeScript and production build pass. Ten focused
  browser checks and fifteen full smoke checks pass, with no skipped tests or
  disabled Axe rules. This smoke reuses the synthetic runtime; final clean
  install and actual restart QA are still required.
- Preference saves expose localized Saving/Saved/error and prevent overlapping
  changes. The schedule preview shows localized publication, expiry and zone;
  selected scheduling controls and labeled groups have accessible semantics.
- Live recovery is bound to a current stream and a fresh projection. The full
  smoke caught a reconnect stall; explicit stream recreation fixed it and both
  focused and full suites were rerun successfully. Hard cache loss and per-card
  expiry have separate behavior and regression coverage.
- All twelve populated candidate captures assert identity, bodies/order,
  Europe/Oslo, locale/theme and Live state. Coordinator personally viewed
  phone/en/light, Shelly/nb/dark and composer candidates. These are not approved
  QA baselines; failure images remain labeled superseded diagnostics.
- Upgraded Chromium requires `http://samvev-m1-app-1:4173` for runtime browser
  commands; the bare `app` name failed navigation. No insecure flags were used.
  QA will update command wiring and verify its own scoped hostname.
- Final backend metadata handoff completed: `has_active_login` accurately
  distinguishes active, disabled and profile-only accounts, and is omitted for
  ordinary members. Integration tests cover visibility for people/account
  managers while preserving email/grant restrictions. All **15 current tests
  pass** (eight web, three core, four API), plus typecheck and runtime restart.
  Coordinator independently verified active/profile-only runtime responses.
- Runtime remains healthy. Current successful synthetic Kitchen display ID is
  `2ffc0c37-80a6-45f7-a09c-f90fe6d7bfef`. Coordinator revoked exactly three
  superseded synthetic Kitchen test credentials through the scoped API and
  verified this is the only remaining active display. Four people remain;
  no installation reset or message-history deletion was performed.

## Gate E QA candidate checkpoint

- Current isolated suite: **16 passed, zero failed/skipped** (web eight, core
  three, API five). The added migration test rejects a corrupted test-ledger
  checksum and restores it in finally without changing schema/data.
- Sixteen isolated smoke checks and twelve candidate profiles pass. Masks are
  narrow timestamp-text ranges; actual localized Oslo strings are separately
  asserted. Reduced-motion evidence compares actual app computed styles.
  Candidate and missing-baseline failure evidence: M1_QA.md and qa-candidates.
- Coordinator independently queried the QA lifecycle ledger at 02:28 UTC:
  missed schedule → expired, valid schedule → published → expired. This is
  checkpoint evidence; a complete final uninterrupted QA run remains required.
- All three read-only rechecks returned. Security findings are source resolved;
  UX accepted visual direction and found a disabled-account label issue.
  Requirements requested tracking corrections, incorporated at this checkpoint.
- Runtime browser replay then found hidden revoked grants are resubmitted by
  PersonEditor. Coordinator confirmed three revoked and one active grant for
  the synthetic limited member. The server correctly rejects unavailable IDs.
  This product failure is retained and routed to frontend, alongside the label
  fix and remaining keyboard/long-text/Timeline/workbench/state evidence.
- No approved visual baseline or final release PASS exists yet. QA released
  its writer slot; frontend is next, followed by UX review and complete QA.

## Gate E final frontend and baseline checkpoint

- F7 now distinguishes active, disabled, profile-only and undisclosed account
  states in both locales. F8 sanitizes only inactive initial display grants;
  a newly selected display revoked during editing still returns a visible
  server error. Original Robin's real runtime edit retained one active grant
  and removed three historical revoked grants; no replacement person hid F8.
- The new keyboard check found F9: Tab could escape a native dialog. Shared
  Dialog now wraps both directions and preserves Escape/opener restoration.
- After the final changes, workspace TypeScript checks, ten web unit tests and
  the production build pass. Full `ux-states.mjs` passed ten checks twice on
  the isolated QA app, producing seventeen screenshots. Evidence:
  [frontend-final/README.md](artifacts/frontend-final/README.md) and
  [UX results](artifacts/frontend-final/ux-qa/ux-results.json).
- Root independently reviewed the account-state, retained-error mobile composer
  and two-author Shelly layout captures and inspected grant/focus source.
  Final UX recheck and QA's independent complete replay remain pending.
- Exact runtime `browser-test` was attempted; pairing returned the genuine
  rate-limit screen after repeated focused tests. No full smoke/focused PASS
  is claimed for this attempt. Final QA must rerun after the normal window;
  no rate limit was reset or changed. Runtime and QA services remain healthy.
- UX personally reviewed all twelve isolated `qa-candidates` images and approved
  their exact manifest, generated `2026-09-07T02:46:05.751Z`, SHA-256
  `255eef840bfe78431a62a5791f788aad8a1e1cd43e1c8b9e6648b66e098ca71f`.
  Approval covers only these images and narrow timestamp masks. QA may promote
  them, then must compare fresh captures with zero changes outside those masks.
- Artifact correction: QA's distinct-person runtime control overwrote
  `frontend-candidates` around 02:49 UTC. Those current files are control
  evidence, not the original 02:02 frontend acceptance or approved baselines.
  Isolated `qa-candidates` is intact. The control added one synthetic teen and
  two test displays; final runtime fixture cleanup/count verification is pending.

## Historical Git delivery blocker and follow-up — resolved

Original Git blocker: coordinator attempted a signed-off documentation checkpoint,
but `git add` failed before committing with `Unable to create .../.git/index.lock:
Read-only file system`. No commit was created. Git metadata was not relocated,
remounted, chmodded or accessed through a container to bypass the restriction.
That was the coordinator's original sandbox failure. The user later reported
host-shell delivery; the first follow-up performed only read-only Git/gh checks
and found the old remote tip and no PR. The user's subsequent direct GitHub
verification of PR #1 and remote head `5e1f384cf8b4322454ea5a200ae457db6738b764`
resolves the delivery blocker. No new commit attempt was made in the sandbox.

Host Node absence is handled through Compose tooling. Local acceptance passed;
the final release gate is PASS with Git delivery externally verified. Only synthetic fixtures
are used. See [M1_RELEASE_GATE.md](M1_RELEASE_GATE.md).

No secrets/private household data introduced. No parent/sibling project or
host-global service modified. No merge, tag, release or production deployment.
