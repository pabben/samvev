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
