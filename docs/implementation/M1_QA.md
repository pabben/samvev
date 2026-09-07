# M1 QA evidence

Last executed: 2026-09-07 UTC. All people, messages, household names and
credentials used by the checks are synthetic. Evidence contains neither
browser storage state, cookies, pairing verifiers nor bearer tokens.

## Current result: complete local QA passed

The final `bash scripts/m1.sh qa-test` exited 0 on 2026-09-07. It includes
fresh demo/accessibility, a second fresh full installation, 17 smoke checks,
10 focused regressions, 10 UX checks, the actual 45-second worker restart and
all twelve normal visual comparisons. The final comparison timestamp is
`2026-09-07T03:53:53.641Z`; every `changedOutsideMask` is zero.
Runtime `browser-test` also exited 0 with 16 smoke and 10 focused checks.

`bash scripts/m1.sh test` passed eighteen tests (web ten, core three, API five),
with zero failures/skips. The coordinator independently reran it; raw output is
[unit-integration.log](artifacts/coordinator/unit-integration.log). TypeScript,
production build, shell syntax, Compose configuration and diff checks passed.
Full dependency audit reported zero vulnerabilities and was independently
repeated. A coordinator scan of modified/new text and structured JSON artifacts
found no secret patterns, persisted auth fields or non-reserved email domains.
`lint` is an empty dispatcher, not meaningful lint evidence.

Evidence paths:

- `artifacts/qa-final/smoke-results.json`: final fresh smoke and separate live /
  captured-page time assertions for all twelve profiles.
- `artifacts/qa-final/review/review-regressions.json`: ten focused checks.
- `artifacts/qa-final/ux/ux-results.json`: full ten checks and seventeen screenshots.
- `artifacts/qa/demo-accessibility-visual.json`: final explicit demo/accessibility.
- `artifacts/qa/acceptance-post.json`: final four restart/ledger checks.
- `artifacts/qa-final/visual-comparison.json`: all twelve actual comparison outcomes.
- `artifacts/runtime-final/`: final runtime smoke/focused results and captures.
- `artifacts/coordinator/final-verification.json`: independent verification.

The screenshot context alone fixes its client Date to
`2026-09-07T02:45:00Z`, preventing weekday/month changes from invalidating narrow
date masks. It uses the real paired credential in memory, restricted API and
SSE, and real card/footer timestamps. No browser storage state is written.
The original live context retains current-time checks and all lifecycle/offline
tests use real clocks. The visual context closes before offline testing.

The original twelve baseline images remain unchanged. Four reviewed Norwegian
clock masks extend one raster pixel rightward; all other masks are unchanged.
One-page diagnostic and final captures passed after a per-profile reload capture
produced thirteen rounded-border pixels. The precise raster cause is not proven;
the earlier temporal-metrics hypothesis was superseded. No further masking,
timestamp-data fixture, image replacement or percentage tolerance was used.
`qa-final/visual-compare-failure.json` is a retained earlier failure at 03:41:52Z,
superseded by the final passing comparison; current PNGs belong to the final run.

The historical checkpoints below explain resolved findings. They are not the
current acceptance result. Final release review and Git delivery are tracked
separately in M1_STATUS.md.

## Historical Gate E candidate checkpoint (not an acceptance result)

At this earlier checkpoint, final uninterrupted QA and visual approval were
still pending. The work below subsequently received the complete retest above:

- `qa-candidates` completed against the isolated QA app: 16 smoke checks and
  12 populated paired-display candidates (mobile 390×844, shared 1920×1080,
  Shelly XL 1280×752; `en`/`nb`; light/dark). The candidate manifest is
  `artifacts/qa-candidates/visual-candidate-manifest.json`.
- Each candidate asserts display identity, the two exact fixture bodies and
  order, `Europe/Oslo`, localized `Live updates`/`Direkteoppdateringer`, and
  no horizontal overflow. Its smoke result records expected and actual Oslo
  header time/date, both card publish/expiry strings, and footer update text.
- Dynamic visual masks are DOM `Range` rectangles for timestamp text only:
  header time/date, card publication time, and the time substring after the
  visible clock icon and `Until`/`Til` label, plus the time substring after
  `Updated`/`Oppdatert`. No whole header, icon, label, card body, or pixel
  percentage allowance is masked. The runner defaults to `compare`; without
  an explicitly approved mask baseline it failed closed with `ENOENT` for
  `qa-approved-baselines/visual-mask-manifest.json` (executed 2026-09-07).
- The smoke now compares computed styles for a real `.button` under
  `no-preference` and `reduce`: a transition exists in the first case and
  `transitionDuration: 0s`, `animationName: none` in the second. This is
  application behavior, not merely a `matchMedia` harness check.
- `services/api/src/api.integration.test.ts` now corrupts only the isolated
  `samvev_test` migration ledger in a `finally`-restored test. `migrate()`
  rejects the checksum mismatch while schema migration count and application
  data remain unchanged; the original checksum is restored before the next
  migration run.

### Historical F8 finding (fixed and retested)

On an existing runtime that contains revoked display grants, open **People**,
edit the affected person, select an active display, and save. `PersonEditor`
initializes its submitted `displayIds` from all stored grants but hides revoked
display checkboxes, so hidden stale IDs are resubmitted. The API correctly
returns `NOT_FOUND`; the dialog stays open with “This item is no longer
available to your account.” This is distinct from duplicate labels and must
be fixed in the UI by retaining only active display IDs before submission.
The initial `bash scripts/m1.sh browser-test` replay exposed this at smoke
line 326. A later isolated candidate capture was clean; the runtime command
is intentionally not masked around this product failure.

`bash scripts/m1.sh browser-test` now invokes the real standalone Node suites
through `npm run test:browser` and uses the Compose runtime DNS name
`http://samvev-m1-app-1:4173`, avoiding Chromium's earlier SSL error from the
bare `app` hostname. Suite order is smoke/setup then focused regressions, so a
fresh unclaimed local installation can establish its fixture before the
focused checks run.

## Final Gate E retest — passed 2026-09-07

`bash scripts/m1.sh qa-test` completed from a newly recreated, label-guarded
`samvev-m1-qa-postgres-data` volume. It passed fresh demo accessibility,
fresh smoke (17 checks), focused regressions (10), UX states (10), a real
45-second `qa-worker` stop/restart, and ordinary approved-baseline comparison.
The final lifecycle IDs are `adebfd5d-2c8c-4f45-88ed-1e03cc507d80`
(missed: scheduled→expired) and `7a13c352-db6d-4b96-9f25-b5d27699c340`
(recovered: scheduled→published→expired). Final comparison records zero
changed pixels outside approved masks for all 12 profiles.

The approved candidate manifest remains SHA256
`255eef840bfe78431a62a5791f788aad8a1e1cd43e1c8b9e6648b66e098ca71f`.
Its original mask manifest SHA256 was
`7878f15d137f3ffa7fa593501bf6a58f6a8b2f6579ec6e9f07243538281c1bca`;
the explicitly approved four Norwegian header-clock right-edge correction is
`fd3e5da25b2f645bc2eabbdb1734fd10d9b96c7ef8b4253a665f79f02d1008b2`.
The original mask file and correction provenance are retained beside the
approved baselines; images were not changed.

The final runtime `browser-test` passed its smoke 16 checks and focused 10
checks against `http://samvev-m1-app-1:4173`; its synthetic paired display ID
is `d6ccec43-19d8-4a3f-b02c-5eb30687bf61`. Runtime evidence is under
`artifacts/runtime-final`; prior `frontend-candidates` files are superseded
runtime control evidence, while `qa-candidates` remains the approved source.

## Historical result at Gate C handoff

**BLOCKED pending Gate E fixes and a full retest.** The isolated stack remains
healthy, and the normal runtime stack was not reset or changed by QA.

### Confirmed findings

1. **Preference-save completion is not observable (acceptance failure).** In
   the real fresh-install smoke, select Norwegian Bokmål and dark appearance
   in the member preferences dialog, then reload immediately. The document
   language persisted as `nb`, while `data-theme` was `light`, not `dark`.
   The recorded failure is in `artifacts/qa/acceptance-pre.json`. The current
   evidence does not distinguish a lost write from an in-flight write with no
   visible saving/saved state. Gate E should expose a durable completion signal
   and test rapid changes for overwrite races; the test must wait for that
   signal rather than a delay.
2. **WCAG AA contrast failure.** Axe 4.13.0 scanned setup, member board,
   composer and restricted pairing under `wcag2a`, `wcag2aa` and `wcag21aa`.
   On the 390 px light member/setup surface it found three serious
   `color-contrast` nodes: people-step body `#60726b` on `#e4eee5` (4.28:1),
   footer `samvev.` and tagline `#76857f` on `#f4f3ee` (3.47:1). Full node
   detail is retained in `artifacts/qa/demo-accessibility-visual.json`.
3. **Full dependency audit fails.** `npm audit --audit-level=moderate` reports
   two high vulnerabilities for `playwright <1.55.1`
   (GHSA-7mvr-c777-76hp). Production-only audit had previously been clean;
   this full audit covers development and browser-test dependencies.
4. **Persistent paired-display visual comparison fails.** Baselines were
   created once using `QA_UPDATE_VISUAL_BASELINES=true`; normal comparison does
   not update them. The new mobile/en/light capture differs by 53.61%, above
   the 1% budget. See `artifacts/qa/visual-regression.json`. Do not refresh
   this baseline until the visual reviewer determines the cause.

### Superseded harness failures retained for traceability

- A browser test was started before the new isolated app became healthy. The
  demo harness now polls `/api/v1/health` for up to 60 seconds.
- The first restart test allowed too little time for Compose restart overhead;
  its recovery message expired. The replacement uses a 95-second recovery
  window and was executed successfully before the lifecycle-ledger assertion
  was added. The later complete run stopped at the preference finding, so Gate
  E must rerun the ledger-enhanced sequence.

## Historical Gate C checks

| Check | Evidence | Result |
| --- | --- | --- |
| Isolated empty-volume first-run UI | Full UI smoke: onboarding/resume, four people, limited sign-in/grant, pairing, immediate SSE delivery/ACK, mobile schedule/edit/withdraw, automated publish/expiry, 12 display profiles, offline/reconnect | Passed through final preference persistence assertion, which failed as described above |
| Explicit fresh-install demo | UI action creates and opens labelled synthetic demo | Passed |
| Restart-safe scheduling | Isolated worker stopped for 45 seconds; missed message expired, valid message published after restart and then expired | Passed in the pre-ledger run; ledger-enhanced repeat pending Gate E retest |
| Unit/integration/migration | `bash scripts/m1.sh test`: web 4, core 2, API/PostgreSQL 3; no skipped or todo tests | Passed |
| Typecheck and production build | `npm run check && npm run build` in project tooling container | Passed |
| Dependency audit | `npm audit --audit-level=moderate` | Failed: 2 high Playwright findings |
| Secret/private-data scan | Credential and private-key patterns, then unintended email/IP patterns outside synthetic allowances | Passed |
| Accessibility | Accessible names, landmarks, focus, supplemental sampled contrast plus Axe scans | Failed: 3 serious contrast nodes |
| Visual regression | 12 persistent paired-display baselines compared to current screenshots | Failed on first profile, 53.61% diff |

## QA command

`bash scripts/m1.sh qa-test` is the documented isolated sequence. It resets
only the exact `samvev-m1-qa-postgres-data` test volume, runs fresh demo and
accessibility checks, then runs a fresh full browser acceptance flow, restarts
only `qa-worker`, checks the lifecycle ledger, and compares visual baselines.
The final command passes after the documented fixes. It leaves
`qa-db`, `qa-app`, and `qa-worker` healthy for investigation.

## Historical retest scope (now executed)

Run the complete `qa-test` command; recheck both locales/themes including
rapid preference changes; require Axe clean on all four scanned surfaces and
the paired populated display; rerun the durable lifecycle event assertion;
and investigate the visual baseline difference before accepting any baseline
refresh. Re-run full audit and the regular isolated PostgreSQL test command.
