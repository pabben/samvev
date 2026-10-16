# Round 13 — active requirement and evidence matrix

Registered 2026-10-15 from the current owner request and the copied
`NEXT_CODEX_PROMPT.md`. **All R13-01 through R13-13 requirements are active in
the current goal.** T1–T3 are the first implementation package within R13-10;
they are not the whole goal. The other requirements remain active and must be
implemented or explicitly resolved before the goal is complete.

This document records requirements and initial status only. It does not claim
new implementation, tests, screenshots, backup/restore, or deployment.

## Acceptance and evidence matrix

`No new evidence` means the requirement is unimplemented/unverified in this
round. `R12 baseline` identifies directly reported older behavior only; it does
not satisfy the new acceptance criteria. Owner-blocked facts must be resolved
without inventing them.

| ID | Granular acceptance criteria | Implemented | Synthetic evidence | Public evidence | Owner-blocked |
|---|---|---|---|---|---|
| R13-01 Agent operations | Record actual agent/model choices and reasoning settings; do not estimate costs without verified pricing; use local runners and durable checkpoints/status; sequence writers on shared files; keep reviews bounded to their roles. | Model selections and resumable checkpoints are recorded in ROUND_13_STATUS; no cost estimates. | Local runner checkpoints recorded. | N/A. | No. Main-agent model/cost remains unasserted. |
| R13-02 Preservation | Preserve current user data, vault, AI tasks/schedules, root Git metadata and LAN admin/runtime. No reseed, reset, disk work, broad cleanup or loss of newer owner writes. Keep secrets/private data out of artifacts. | R12 data/vault baseline preserved; main verified 229 protected root Git hashes unchanged at display-message checkpoint. No new full database backup/restore gate yet. | Isolated Compose runners; no QA/public reset. | R12 only; public runtime unchanged. | No. Disk work is already complete; do not repeat it. |
| R13-03 Day overview and birthdays | Show today's/tomorrow's day overview in household local time; birthdays due today/tomorrow with subtle balloons; honor reduced-motion; support multiple birthdays; never infer age. Midnight changes update without forced reload. | Calendar preview baseline from R12; birthday/day DTO backend implemented locally. UI celebration, reduced-motion and full acceptance remain open. | Existing saved birthday/household setting verified in aggregate; Home backend focused suite 15 pass and API check passes. | R12 calendar baseline only. | No. |
| R13-04 People, week and school items | Person-card preview contains only today/tomorrow items; person details keep all fetched future activities in chronological date groups. Quiet cards do not repeat empty messages or redundant CTAs. Provide current/next-week views with paging and optional exactly one explicitly selected next event. School results appear only on actual actionable subject/person cards; expire at a known school end time on that relevant day, otherwise at 13:00 on the relevant date in the household timezone; future preparations use their own dates; unchanged source cannot resurrect expired items; details/history remain available; results stay off family table; presentation/subject edits make no AI calls. Card heights reflect content and empty/error states are honest. | Bounded Home chronology, school metadata and display week/next/person/saved-school ACL chronology backend implemented; full card/week/school UX remains open. | Home 15 focused tests/API check; Display 036 focused tests and all-five-workspace check. | R12 calendar preview/details only; no R13 public UI. | No. Fallback is 13:00 on the relevant date, not a school-year end or “13th day.” |
| R13-05 Waste | Remove separate Next Waste surface. Preserve waste icons in the day overview and existing import. Any optional next-event card is one selected event under R13-04, not a dedicated waste widget. | R12 baseline has waste-purpose import/day-plan support; requested removal is unimplemented. | No new evidence. | R12 baseline only. | No. |
| R13-06 Display identity/configuration | Open/copy addresses for existing display pairings without exposing URL secrets; pair a new device; revoke any device independently. Reuse one selected display setup for multiple individually revocable devices without silently duplicating configuration. Family layout is independent of external-data opt-in; layout selections never grant read access. Per-display preview includes cards, order, people, sources, temperature, background, theme, language and actions. Server enforces projection ACL; protected images/caches cannot leak across displays or revocation. | Backend policy GET and read-only previews filtered by the real device's grants are implemented, including protected media/photo projections, draft filters, bounded new-message cards and ACL-filtered device/person/school chronology. Display setup/preview UI/browser remains open. | Migration 036 checkpoint: all five workspace checks exit 0; 15/15 display/media/image tests pass; final combined backend checkpoint 42/42 pass, zero failures/skips/cancellations; strong review/repair closed stale-photo-grant, draft-filter, final-expiry, privacy and lock-order findings. Old order counterfactual returns 500; exact source restored. Isolated runner actual exit 0, 81.8 seconds. | R12 ACL baseline only; no R13 display UI/public verification. | No. |
| R13-07 Permissions | Read-only is default. Optional message creation uses the real stored display author identity and never impersonates a member; recipient scope remains restricted. Grocery, dinner, photo and HA grants are separate. Display writes require an explicit capability. Enforce all grants server-side. | Display authorship, per-device recipient/action policy, history, revocation and replay boundaries implemented in backend; UI and public verification open. | Final combined backend checkpoint 42/42 pass, zero failures/skips/cancellations; bounded findings closed. | No R13 public evidence. | No. |
| R13-08 Messages and media | Message author/avatar is clear; handwritten body remains readable; emoji render; match reference `23_52`; keep Samvev identity and no family footer. Private background upload/reset works. Shared album has slow loop, pause/interval controls, mobile orientation behavior, resized uploads, quotas, GPS metadata removal, backup/restore, deletion and current-ACL checks. | Persisted display authors and private media/background backend implemented; typography/playback/UI, second restore and public acceptance remain open. | Media 10 focused tests plus API 4 pass; deterministic authorization/quota/lock regressions and typechecks pass. | No R13 public evidence. | No. |
| R13-09 Grocery and dinner | Concurrent durable grocery add/check/undo/delete works for authorized household members. Dated dinner entries support emoji and prevent duplicates. Display can write only with explicit display grant. | Native grocery/dinner backend with revisions, tombstones and independent device grants implemented; UI open. | Main combined backend checkpoint 21/21 includes native concurrency, revocation and clear/reassign tests. | No R13 public evidence. | No. |
| R13-10 Home Assistant and T1–T3 | Only selected temperature/light/garage commands run through backend allowlists. Grants are person/display-specific; state freshness/errors are visible; garage requires confirmation. Do not auto-test physical commands or queue offline commands. Shelly communicates through HA. Additionally satisfy T1–T3 below. | T1–T3 and selected, explicit-grant HA light/garage backend implemented; UI and physical owner verification remain open. | HA focused migration/API/contracts and 3 synthetic tests; Display 036 expiry/filter regressions; final combined backend checkpoint 42/42 pass, zero failures/skips/cancellations, isolated runner actual exit 0 in 81.8 seconds. | R12 read-only baseline. Current public state has one existing HA connection; preserve it and do not ask for a generic reconnect. | Live consent is separate; no secret is needed for isolated fixes. |
| R13-11 Public information pages | Anonymous `/om`, `/personvern`, `/vilkar`; content accurately describes data flows/privacy and verified operator/contact; discreet login/help, no family footer. Google Pages authoring remains a separate backlog task. | Candidate includes anonymous DTO, safe runtime config path, page routing/content and copy/login/help links. Private contact values are not initialized publicly. Keep actual values out of Git. | guides037 web checks: 100 tests and build exit 0; five workspace checks pass. | Public runtime remains R12; no R13 browser/visual verification. | No; content work is not blocked, private values stay out of Git. |
| R13-12 Google and Microsoft setup | Google guide has five steps covering API/client/callback/Branding/Audience/connection; uses current official docs; states scope of testing vs publishing vs verification; includes exact Branding table and missing owner fields. Microsoft distinguishes installation-owner directory/app registration from calendar-account authorization; supports personal and work accounts; does not guess account-lock cause; cites current free eligibility; never creates an organization. | Google and Microsoft guides implemented; interactive setup wizards and live provider verification remain open. | guides037 web checks: 100 tests/build exit 0; five provider-focused checks pass. | One Google connection exists but is not currently connected; `disconnected_at` is null, so do not characterize it as revoked. No live provider verification. | Owner registration/consent may be required for live validation, but guide work is not blocked. |
| R13-13 Traceability, QA and release | Keep this implemented/synthetic/public/owner-blocked matrix current. Use fictional people/data and local runner. Run meaningful full-target tests, backup/restore and review. Release gate runs last. Public test deployment is authorized. DCO-sign feature-only delivery. No PR, merge, main/force push, tag/release or Actions dispatch. Report files, tests, risks, migration/rollback, screenshots and data/secret hygiene. | Current status and checkpoint evidence are registered; complete target QA, backup/restore, release gate and deployment remain open. | Temperature/Home/display suites are checkpoint evidence only; full retest remains open. | R12 evidence is historical; no R13 deployment. | No, except explicit live provider consent. |

## First implementation package: temperature T1–T3

These three defects are the first package, not a scope replacement for the matrix
above. Source locations below are from the copied owner mailbox/reviewed source;
verify current code before edits.

| ID | Reproduction and required acceptance | Initial status | Likely file ownership and dependencies |
|---|---|---|---|
| R13-10-T1 | With synthetic HA, select registry A (`sensor.synthetic_outside`), then rename A and let registry B take A's former entity ID. Preview and worker polling must resolve and verify A's stable registry identity before reading and again before persisting, including concurrent rename/discovery. Never show B under A's name or sharing. If identity is missing/mismatched, keep last valid observation marked stale/unavailable and expose recovery. Legitimate rename preserves account/name/order/grants. For no-registry sources, document limits and require explicit revalidation; never merge or transfer grants. Test rename, takeover, missing/changed registry rows, preview, worker, race, and wrong returned entity ID. Preserve origin/DNS/time/response guards; do not fault-inject live owner HA. | Backend implemented and reviewed; 7 focused sensor regressions plus 16 existing provider/HA regressions pass. Integrated UI/public verification remains open. | Backend owner: `services/api/src/calendar/service.ts`, `home-assistant-client.ts`, relevant registry contracts/tests. Depends on existing stable-ID model and safe write/revision boundary. |
| R13-10-T2 | Active authorized sensor → provider disable → same-origin/account valid OAuth. Resume scheduled polling automatically, revalidate identity/type as needed, retain stale state until a valid new reading. Never leave an active sensor silently unscheduled. Preserve pause/stop/disconnect/revocation. New origin/account cannot inherit old grants without explicit validation/approval. Test active recovery, paused/inactive, missing source, revoked owner, failed consent, old callback/in-flight poll and origin change; preserve calendar recovery/F1–F3. | Backend recovery/origin consent implemented and reviewed; focused and existing regressions pass. Integrated UI/public verification remains open. | Backend owner: provider configuration, OAuth completion, worker scheduling and tests. Depends on T1 identity validation and generation/revision/lease guards. |
| R13-10-T3 | With 300 allowed calendar entries for member / 200 for display and one or more permitted sensors, temperatures remain available through a bounded separately ACL-filtered projection. Do not raise global item limits indiscriminately or fetch unbounded data. Preserve calendar/reminder behavior, privacy mode, display/person grants, disconnect and revocation. API/server tests cover both limits, multiple sensors, allowed/denied users and displays, SSE/update/withdrawal; assert denied values and metadata are absent. | Separate bounded ACL-filtered sensor projection implemented; member/display calendar-cap regressions pass. Final integrated/public verification remains open. | Backend owner: Home API projection and calendar service; frontend only if settled API/SSE contract requires it. Depends on T1/T2 behavior and server ACL. |

## Dependencies and reviewer ownership

- Read-only architecture/security/UX/requirements reviews should be bounded to
  their expertise and avoid repeating broad repository surveys. The explicitly
  selected security reviewer for display identity/authorization is
  `gpt-6.1-sol` at high reasoning. Do not infer an unprovided main-agent model or
  cost.
- Use one writer at a time. Backend owns T1–T3 and server-side permissions;
  frontend owns the product surfaces after API contracts settle; public-page
  factual copy waits for verified owner details. QA owns meaningful tests and a
  complete retest after fixes. Security/requirements/UX review after
  implementation; release gate runs last.
- Preserve newer edits by others. No writer may reset or revert another writer's
  changes. The main agent integrates and independently checks critical claims.
- Scope includes all R13-01 through R13-13 whether or not a single deployment can
  meet them in one pass. If a requirement is deferred, document it as unresolved
  and keep the goal active; do not silently mark the overall goal complete after
  only T1–T3.

## Baseline facts and environment

Round 12 reports source `00ddc36f74fa41925fc0cc6e9b7e6b462e96a37a`, image
`sha256:baa1c70f781ae887a791e52c120a674384f1b9737a6093aee2d1785aa0806a02`,
review `fb9998b83ac1d7962edc05747d7982a99f18fcd5`, and round
`20261015115219-00ddc36f-d69a86e7`. It reports 374/374 tests, five workspace
checks/builds, public HTTPS/ACL/SSE checks, migration 026 and restore evidence.
Those reports are historical baseline, not R13 acceptance proof.

At initial registration, root Git HEAD `390f6a6` was intentionally stale versus
publisher `df04e82`, and the 246 runtime files matched deployed R12. Newer R13
work is now present. Current publisher/origin checkpoint is
`a887028a4344ebb33b828d44e6a4fa3b44ec90da`, containing T1–T3, Home and display
packages A+B. Do not treat historical root Git dirt as new work or recreate
checkpointed changes. The two guest disk expansions are complete; no disk job is
authorized. Preserve root Git, existing LAN admin, data, photos, vault,
sensor/calendar choices and AI schedules.

## Current checkpoint — local backend only

Publisher/origin checkpoint `a887028a4344ebb33b828d44e6a4fa3b44ec90da` contains
T1–T3, Home and display setup/messages packages A+B. Display package B is DCO
signed/pushed. The latest independent combined backend checkpoint passed 52/52
with zero failures/skips/cancellations; see
`.local/m3/round13/backend-guides-checkpoint.log` (isolated runner, actual exit
0, 101.5 seconds). Earlier narrower checkpoints remain historical. This is not
full QA, release-gate or public evidence. Round 12 remains the deployed public
source. HA physical controls, shared UI, browser/screenshots, full QA, restore
and public verification remain open. See the current status table in
`ROUND_13_STATUS.md`.

The guides037 workspace includes candidate anonymous-page and provider-guide
behavior. Contact values remain private and are not initialized publicly;
public runtime remains R12 pending browser/public verification.
`.local/m3/round13/guides-web-final.log` records 100 web tests and build exit 0;
initial five workspace checks and five provider-focused checks passed. The
independent combined backend run is 52/52 with actual exit 0 and zero
failures/skips/cancellations. These checks do not complete shared UI, full
visual QA, backup/restore or release acceptance.

### Home backend evidence checkpoint

R13 birthday/week/school backend is locally implemented and synthetically tested
(15 passing focused/regression tests; API typecheck pass). Four bounded review
findings were fixed and re-reviewed. UI and public verification remain open.
Evidence: `.local/m3/round13/home-focused-tests.log` and `home-api-check.log`.
No completion claim applies to the full birthday, school or chronology UX yet.

### Display setup backend checkpoint

Reusable setup selection and actual device permissions are separate. Migration
029 preserves old devices and legacy inserts; new pairings copy no device grants.
Scoped assets, source/person narrowing, authority rechecks and invalidations have
passed bounded review. Local complete API (4/4) and Round 9 (5/5) tests pass.
These include strengthened existing tests, not nine newly created test cases.
Display UI, real-browser cookie checks, author/actions and public verification
remain open. See ROUND_13_STATUS.md for exact evidence.

### Display actions/backend integration evidence checkpoint

R13-07 display-authored messages, explicit per-device recipient/action policy,
author history and revocation/replay boundaries are locally implemented and
reviewed. Main independently ran 20 combined API/calendar/Home/temperature/display
backend tests, all passing (`backend-display-checkpoint.log`). UI and public
verification remain open. Grocery/dinner/media/HA flags do not imply those
features are implemented yet. Owner contact values for R13-11 are now confirmed
privately; public config/pages are still pending.

### HA backend follow-up

The HA controls checkpoint also fixes an existing provider-origin-change SQL
ambiguity discovered by the actual synthetic configuration/OAuth roundtrip.
No live command or provider consent is claimed. Native/media backends are
implemented (031/032); all corresponding UI, restore and public proof remain
open. The current backend source is the commit containing the latest status
update; older SHA references above are historical checkpoints.
