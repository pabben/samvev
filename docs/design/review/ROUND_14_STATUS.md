# Round 14 resumable status — 2026-10-27

## Current checkpoint

**Status: implementation in progress; no R14 public release yet.** R14 includes
all three owner issues and proceeds sequentially: supplied-reference review and
compact calendar (#15), ICS link onboarding (#14), Anthropic provider (#13).
The acceptance matrix is [ROUND_14_REQUIREMENTS.md](ROUND_14_REQUIREMENTS.md).

All three issue records were read in full from `.local/m3/round14/issues/`:
13, 14, and 15. Each has no comments. The R13 owner-action checklist remains a
separate, nonblocking follow-up; historical mailbox T1–T3 work is not reopened
as R14 scope.

The bounded issue scan found these three as the only updates in the supplied
2026-10-26T23:29:24Z–2026-10-27T23:29:24Z window. No issue comments were
present. Issue #15 private member names are intentionally not copied here.

## Baseline and boundaries

- Root source inputs reportedly match publisher `0f808404…`; public app remains
  source `7c61557` with image `a0668cc…` and healthy runtime. QA health is
  reported, but its provenance metadata is stale and it is not fresh-source
  R14 evidence. Recheck before using it as a gate.
- R13's public deployment, 485-test immutable QA, visual checks, and restore
  evidence are historical context, not R14 proof.
- Preserve current user data, vault, existing provider connections, AI
  tasks/schedules, protected Git metadata and runtime. Do not call AI, alter
  schedules, inspect private issue names into docs, or put secrets/private
  content in artifacts.
- Use synthetic six-person data (2 adults, 4 children) and local runners. Record
  actual before/after screenshots and review them. After implementation, run
  required review, fresh QA and backup/restore before any separately authorized
  public publication. Keep any delivery feature-only and DCO-signed.
- Calendar/provider tests stay synthetic until an owner supplies a private
  calendar URL or Anthropic key and explicitly authorizes live verification.
  R13 Google/Microsoft consent and saved-school activation remain separate,
  nonblocking owner actions.

## Work sequence

1. Review the supplied actual design reference and current UI; capture and review
   before/after for desktop, mobile and tablet portrait in both themes. Add a
   clear member Calendar entry that reuses `HouseholdActivityWeek` and its shared
   API. Complete compact event rows/details, a visible canceled state, and
   collision-safe unique server-persisted accessible colors.
2. Inspect and reuse the current ICS engine; complete GUI, preview, ACL choices,
   status, guarded refresh and recurrence/DST/cancellation evidence.
3. Inspect the existing AI provider architecture; add Anthropic behind it with
   encrypted secret handling and synthetic transport tests. Leave real calls to
   explicit owner action.
4. Run bounded security, requirements and UX reviews, then complete QA and
   release/restore review. Update this status with exact evidence and unresolved
   owner actions; do not claim completion from R13 evidence.

## Coordination record

Requested review models: repo scout, requirements and UX review `gpt-6-luna`
high; solution architecture review `gpt-6.1-sol` high. Writers are sequential
in the shared worktree. No model cost is estimated. This registration changes
documentation only; no application data, provider credentials, AI jobs,
schedules, publisher source, or public runtime were changed.

## Implementation checkpoint — 2026-10-28

- Backend person-color migration 038, deterministic allocation and authorized
  projections are implemented. Focused color tests and API/contracts type checks
  passed; integrated acceptance remains pending.
- Full and sparse cancellation handling is being tested. Bounded architecture
  review found incomplete-snapshot, freshness and ordering defects; corrections
  are present but two existing R9 integration assertions still fail and must be
  diagnosed before approval. No release claim is made.
- Coordinator and UX agent opened actual desktop before images from immutable
  publisher source `0f808404e1152e3849d7fabacc4081bcb8f9dcf1`.
  Main visual gaps: content-stretch whitespace, narrow management pages and
  metadata-heavy calendar rows. Frontend implementation follows this audit.
- Before capture uses an isolated internal Docker network/database, six fictional
  people and no worker or provider credentials. Settings dialog smoke now passes;
  full light/dark desktop/mobile/tablet before matrix is running.
- ICS and Anthropic implementation remain pending. Current official Anthropic
  API/model documentation was checked; real API calls remain owner-controlled.
- Writers are sequential: backend frozen during QA helper repair, then frontend.
  Read-only tests/reviews may overlap. Public runtime and LAN remain unchanged.

### First integrated candidate checkpoint

R9 lifecycle test data now uses a relative future event, preserving dedicated
DST coverage; its five tests passed normally on the local Docker runner.
Frontend typecheck/build and 12 focused presentation tests passed. The build
used `/tmp/samvev-r14-candidate` and did not replace the active LAN dist.
Before capture has 48 images; coordinator independently verified all hashes
and opened desktop dark, mobile light and tablet settings captures.

The first UI candidate is for visual iteration only. Known follow-ups include
consolidating the late CSS override sheet into shared component styles and
removing unused status-column space in compact mobile rows. No R14 publication
or design acceptance is claimed. ICS/Anthropic remain pending.

### Second candidate checkpoint

- First candidate `d8a616d` was rejected by coordinator/UX visual review: large
  Home gaps, inconsistent avatar colors and empty calendar status columns.
  Its 60-image manifest hashes/sizes were independently verified. A keyboard
  diagnostic corrected an initial false-positive Escape assertion: Enter worked,
  but Escape from the row trigger did not dismiss details.
- Corrective frontend now consolidates shared styles, uses persistent avatar
  colors, reworks Home composition and fixes row Escape/gradient stripes. Web
  typecheck, isolated build and 14 focused frontend tests pass; fresh visual
  approval and browser checks are still required.
- ICS migration 039 and interval API are implemented. Focused API integration
  6/6 and transport 10/10 plus API/contracts typechecks passed locally. The
  coordinator checked logs and identified additional authenticated permission
  tests and a preview-count assertion correction still required.
- The enriched before capture needs its album-selection timing fix and complete
  recapture. Existing partial refreshed baseline must not be used as final proof.
  Fixtures remain synthetic, provider transports absent and no physical actions.
- Anthropic remains pending. Public runtime/LAN dist remain unchanged; no push,
  public release or final acceptance has occurred.

### Third visual iteration — 2026-10-28

The second source candidate `dcf3496` was rejected after actual captures showed
legacy grid rules overlapping cards and avatar colors ignoring persisted tokens.
A bounded stronger frontend agent scoped the legacy display layout separately,
restored mobile actions and corrected shared identities. Coordinator and UX
opened the actual Home/Calendar images against the primary reference. The new
composition is substantially closer, with four primary columns, compact family
identities and a message/landscape-photo row.

Local isolated web typecheck/build and 149 tests pass. Prototype browser checks
cover Home/Calendar at 1920, 1280, 820 and 390 pixels in both themes; four Home
accessibility scans report no violations. These are development-prototype
results, not final immutable-source screenshots or public acceptance. Image
loading stability and complete changed-surface capture remain pending.

ICS focused integration tests now pass 6/6 with authenticated permission and
recurrence coverage. Anthropic base tests pass 11/11, but independent review
found protocol and failure-classification defects; corrections, explicit
fallback, daily admission limits and administrator UI remain pending. No real
provider request has been made.

Fresh read-only public checks confirm healthy R13 source `7c61557` and schema
037. Protected root Git still matches all 229 saved fingerprint entries. Public
runtime and LAN dist remain unchanged; no R14 push or deployment yet.

### Provider and capture checkpoint

Anthropic base migration/typecheck and 14 focused synthetic tests now pass.
Review corrections preserve pre-wire failures, reject duplicate tool results,
and avoid unsupported forced-tool mode on Sonnet 5.5. Explicit fallback and
admission limits are the next implementation step; failure eligibility still
needs fail-closed tightening for malformed upstream error bodies.

The coordinator independently ran the updated capture-asset/publication tests:
11/11 passed. Protected household media now receives authorized loading proof
with only templated routes and coarse status in public evidence; image hashes,
IDs and bytes remain private. A same-album reselect UI bug is corrected, with
its browser regression still pending. The isolated real-UI ICS harness is
prepared against source `088eb00`; initial route setup was corrected before
continuing its functional checks. None of this is a live-provider verification.
