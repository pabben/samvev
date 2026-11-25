# Round 14 resumable status — 2026-10-28

## Authoritative final delivery — 2026-10-28 03:59 UTC

Public test deployment and scoped HTTPS verification **PASS** at https://samvev.pabben.org/. Source/deploy `971913e321dd82f491214fdbda81d08f8123a891`; image `sha256:4aef88306949a5b591e4af94ce0e769d3dffe73526dad663fa90ab8e44160342`. Round `20261028032511-971913e3-046fbbb8`. Final local 526 tests, UX/security/readiness gate, fresh pre-cutover restore and postdeployment restore passed. Owner authorization/key/private-calendar/school actions remain separate. Public People color editing was not authorized for the synthetic smoke account; isolated editing tests passed. All lower checkpoint/pending statements are retained historical records, not current status.


## Final candidate checkpoint

**Status: final local candidate; UX review PASS. Public deployment and HTTPS
post-deployment smoke remain pending.** The candidate source is
`971913e321dd82f491214fdbda81d08f8123a891`; candidate image is
`sha256:4aef88306949a5b591e4af94ce0e769d3dffe73526dad663fa90ab8e44160342`.
The final source passed five workspace typechecks and 526 tests (web 153,
contracts 5, core 3, API 365). The isolated visual evidence contains 70 primary
screenshots plus seven supplements. See the [visual evidence index](round-14/README.md),
[sanitized manifest](round-14/manifest.json), [test evidence](ROUND_14_TEST_EVIDENCE.json),
and [delivery report](ROUND_14_REPORT.md).

No real Anthropic/model request, private calendar verification, or physical Home
Assistant command was made. The active public site remains on its prior release
until a separately authorized deployment and smoke check.

## Historical work log (superseded by the final candidate checkpoint above)

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

### Integrated AI policy and UI checkpoint

Explicit reserve configuration, queue-time revision pins, mandatory task/worker
leases, UTC daily physical-request admission and per-attempt usage metadata are
implemented. The coordinator reviewed admission, preservation and counter paths;
a zero-dispatch counter defect was returned to the writing agent and corrected.
The 63-case focused group passed before that last correction; a targeted retest
is running. Existing provider fixture expectations were updated for typed key
and rate-limit failures, retaining no-fallback assertions.

Administrator UI includes named Claude models, explicit reserve selection,
request-count limits and actual route/usage details. Web typecheck and targeted
tests passed. Coordinator review corrected copy that confused configured support
with live availability and clarified conditional Console/API credits. No live
provider request was made. ICS browser work is continuing on isolated source
`088eb00`; its test account's normal login throttle is respected, not bypassed.
All complete-release gates remain pending.

Final backend checkpoint: API typecheck and 65 targeted fallback/provider/agent
tests pass, including zero physical requests after pre-wire refusal. The prior
affected integration group passed 63/63; its unchanged OAuth/queued-execution
coverage remains relevant. These are isolated synthetic tests, not live calls.

The actual ICS UI flow passed after normal test-account throttle expiry:
preview, distinct subject/reader/display, activation, 15→5→30-minute schedule,
reload persistence and manual refresh. API/database relationships and three
synthetic transport fetches were checked; zero unexpected transports. The saved
runner still needs its onboarding/resume/text-selector corrections persisted,
and final-candidate repeat plus browser-error assertions remain pending.

### Full-QA findings and corrections

The first full workspace run passed web 152, contracts 5 and core 3 tests; API
passed 356/364 and therefore stopped the run before worker completion. All
workspace typechecks passed. Failures were investigated rather than skipped:
new color fields required explicit DTO expectations; stale fixed-date calendar
fixtures were replaced with future-relative lifecycle/window dates; dependent
fixture failures then cleared. Explicit migration-ledger expectations now
include 038–041. The four affected integration files pass 19/19, with the final
far-window calendar adjustment separately passing 5/5.

The reserve repair guard incorrectly treated injected providers without a known
primary pin as switched routes. It now compares only known pins; an actual
primary-503/reserve-malformed regression still proves exactly two requests, no
fresh repair and no publication/approval/schedule change. Existing weather flow
coverage passes after retaining its validation fields and new safe provider
metadata.

Actual AI UI testing found an unassociated Anthropic model label caused by a
fragment inside the shared Field component. The scoped fix keeps input nodes
direct children, with rendered label/ID and datalist regression checks. Web
typecheck and three focused UI checks pass. Full frozen-candidate QA and actual
UI repetition remain required.

Independent security review of `cc38ebf` found no new boundary regression and ran
33 additional synthetic tests. Requirements review confirmed the publisher
provenance, owner-scoped usage and conditional billing guidance. Ops review
rejected the first private restore helper: embedded schema checks were invalid
and incomplete. Those helpers have not run against public data and must pass
executable schema validation and independent re-review before use.

### Integrated verification and final visual corrections

Source `2693fba96c18f59eade8c3715febc4718d5f6445` passed all five workspace
typechecks and 526 tests on the local isolated Docker runner: web 153, contracts
5, core 3, API 365; worker has no tests. The coordinator checked the exit codes
and logs. The actual browser ICS flow and AI configuration/explicit reserve
flow passed using guarded synthetic transports, with no unexpected provider
requests or page exceptions. A separate bounded security review passed.

The coordinator verified 241 recorded source hashes against Git blobs, all 12
built assets and all 68 image hashes. UX and coordinator opened actual images
and reference/before/after panels. Desktop/mobile materially improved, but
tablet portrait was rejected: the shared header overflowed 768px. The scoped
two-row tablet correction and browser geometry regression are under final
verification. Initial paired displays correctly showed empty authorized
projections; populated six-person display evidence requires explicit synthetic
grants and is not inferred from those empty captures. Two capture assertions
(stripe timing and hashed-background filename) were false negatives; original
failed evidence remains preserved and corrected checks must pass.

The review pipeline now stages an immutable-source build outside active LAN
dist. Explicit activation retains the previous artifact and switches only the
QA app startup to direct API execution, with strict configuration, source,
runtime and served-asset verification. Fixture checks and read-only preflight
have passed; actual staged build/activation and canonical capture remain open.

Private restore helpers passed 19 schema/generator/wiring fixtures and an
independent wiring review after correction. A fresh public custom-format backup
and 37-row baseline ledger were captured and its TOC parsed; no public runtime
change has occurred. A real isolated restore/migration gate, release gate and
public verification still remain. Protected root Git metadata matches all 229
recorded files. Origin and issue metadata were rechecked; no newer branch work
or issue changes were found. Owner consent/key/school actions remain separate.
