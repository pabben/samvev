# Round 13 — active requirement and evidence matrix

Registered 2026-10-15 from the current owner request and the copied
`NEXT_CODEX_PROMPT.md`. **All R13-01 through R13-13 requirements are active in
the current goal.** T1–T3 are the first implementation package within R13-10;
they are not the whole goal. The other requirements remain active and must be
implemented or explicitly resolved before the goal is complete.

The matrix below is the current status snapshot. Historical dated checkpoints
remain useful as evidence for their time, but do not override the current rows.
No status here implies public deployment unless explicitly stated.

## Acceptance and evidence matrix

`No new evidence` means the requirement is unimplemented/unverified in this
round. `R12 baseline` identifies directly reported older behavior only; it does
not satisfy the new acceptance criteria. Owner-blocked facts must be resolved
without inventing them.

| ID | Granular acceptance criteria | Implemented | Synthetic evidence | Public evidence | Owner-blocked |
|---|---|---|---|---|---|
| R13-01 Agent operations | Record actual agent/model choices and reasoning settings; do not estimate costs without verified pricing; use local runners and durable checkpoints/status; sequence writers on shared files; keep reviews bounded to their roles. | Economical writers used `gpt-6-luna/high`; bounded security/operations reviewers used `gpt-6.1-sol/high`. Coordinator model and costs are unasserted. | Checkpoints and exact synthetic evidence paths in ROUND_13_STATUS; no cost estimates. | N/A. | No. |
| R13-02 Preservation | Preserve current user data, vault, AI tasks/schedules, root Git metadata and LAN admin/runtime. No reseed, reset, disk work, broad cleanup or loss of newer owner writes. Keep secrets/private data out of artifacts. | Data, vault, schedules, protected root Git and R12 public/LAN runtime preserved. Two accidental default Vite output incidents were restored and hash-checked against R12; no DB/public change. Future builds go to `/tmp`. | R12 asset restoration and health/admin/FamilyHub evidence summarized in ROUND_13_STATUS; no data reset. Restore gate still open. | R12 only; public and LAN unchanged. | No. Disk work is complete; do not repeat. |
| R13-03 Day overview and birthdays | Show today's/tomorrow's day overview in household local time; birthdays due today/tomorrow with subtle balloons; honor reduced-motion; support multiple birthdays; never infer age. Midnight changes update without forced reload. | Birthday/day UI and all-day boundary backend implemented; source-built Home layouts reviewed. | Home/all-day 23/23 (five all-day, eight source-catalog, five display, five Home), API/contracts pass; `.local/m3/round13/all-day-strong-final.log`; old query fails four red counterfactuals. Full QA snapshot and seven Home layouts; no birthday age inference. | R12 only; no R13 public deployment. | No. |
| R13-04 People, week and school items | Person-card preview contains only today/tomorrow items; person details keep all fetched future activities in chronological date groups. Quiet cards do not repeat empty messages or redundant CTAs. Provide current/next-week views with paging and optional exactly one explicitly selected next event. School results appear only on actual actionable subject/person cards; expire at known school end time on that relevant day, otherwise at 13:00 local on the relevant date; future preparations use their own dates; unchanged source cannot resurrect expired items; details/history remain available; results stay off family table; presentation/subject edits make no AI calls. Honest card heights/empty/error states. | Candidate UI and backend evidence current; local-date person-future, school provenance and C2 presentation metadata/font follow-ups are complete. Existing saved school tasks still need safe classification/activation from actual task origin and subjects under a real `household.manage` session; no impersonation, copies, AI calls, approval or schedule mutation. | Home layout/bounds and browser evidence; all-day focused suite/API checks as R13-03. Activation is not claimed live. | No R13 public UI; R12 preview/details only. | Authorized household session required for existing-task activation; never impersonate. |
| R13-05 Waste | Remove separate Next Waste surface. Preserve waste icons in the day overview and existing import. Any optional next-event card is one selected event under R13-04, not a dedicated waste widget. | Separate surface removed; day overview waste icons and existing import retained in candidate. | Included in candidate/full QA snapshot; no separate test count claimed. | R12 only. | No. |
| R13-06 Display identity/configuration | Open/copy addresses for existing display pairings without exposing URL secrets; pair a new device; revoke any device independently. Reuse one selected display setup for multiple individually revocable devices without silently duplicating configuration. Family layout is independent of external-data opt-in; layout selections never grant read access. Per-display preview includes cards, order, people, sources, temperature, background, theme, language and actions. Enforce projection ACL and prevent protected-image/cache leaks across displays/revocation. | Backend and setup/pairing/profile UI implemented in DCO-signed feature source `d91436addb4a55f7b27ae27df549b173fa276fe7`. Open/copy now appears outside the pairing dialog; root reviewed and accepted the desktop address screenshot. | Focused display 5/5; setup/pair/default-deny, explicit grants, actual identity/revoke, six board ticks/focus, compact four-screen review. Latest web TypeScript and address2 browser pass; the 468 full-QA run predates the header adjustment. | R12 only; no R13 display deployment or capture. | No. |
| R13-07 Permissions | Read-only is default. Optional message creation uses real stored display author identity, never member impersonation; recipients restricted. Grocery, dinner, photo and HA grants separate. Display writes need explicit capability, enforced server-side. | Display authorization, persisted author, grants/revocation and explicit action paths implemented and browser/API exercised. | Actual allowed-recipient POST 201 stores display author name and null person ID; revoke removes composer. Six-case composer lifecycle browser evidence; full QA snapshot below. | No R13 public evidence. | No. |
| R13-08 Messages and media | Message author/avatar clear; handwritten body readable; emoji render; match reference `23_52`; Samvev identity, no family footer. Private background upload/reset. Shared album slow loop/pause, mobile orientation, resizing/quotas/GPS strip, backup/restore, deletion and ACL. | Media frontend and local browser authorization/playback acceptance passed on synthetic fixture. Backup/restore and public acceptance remain open. | 109 frontend checks plus actual album upload/preview/reload, sharing/revocation, playback/pause and background apply/reset reviewed. | No R13 public evidence. | No. |
| R13-09 Grocery and dinner | Concurrent durable grocery add/check/undo/delete works for authorized household members. Dated dinner entries support emoji and prevent duplicates. Display can write only with explicit display grant. | Native grocery/dinner backend and candidate UI have bounded browser acceptance; full QA snapshot passes, while integrated release/public acceptance remains open. | Isolated browser evidence under `.local/m3/round13/boards-browser/`: grocery add/check/uncheck, two-page sync, dinner assignment/reload, option delete/snapshot clear, stale 503/clear 403 and mobile hit-test; six fictional people. Real HTTP uncovered unavailable `crypto.randomUUID`; secure `getRandomValues` UUID fallback and regression added. | No R13 public evidence. | No. |
| R13-10 Home Assistant and T1–T3 | Only selected temperature/light/garage commands run through backend allowlists. Person/display-specific grants; state freshness/errors visible; garage confirmation; no auto-test of physical commands/offline queue; Shelly via HA. Additionally satisfy T1–T3. | T1–T3, explicit selected HA controls and UI implemented; source `5b39d4375ff8373657f5bfd3492fa52e842326ea` DCO-signed/pushed. No live/physical action performed. | Credential-lease serialization 10 focused tests; actual synthetic-transport browser checks and five viewed images; full QA below. | R12 read-only baseline; existing public HA connection preserved; no R13 public controls. | No owner authority needed for synthetic tests; live operations remain separate. |
| R13-11 Public information pages | Anonymous `/om`, `/personvern`, `/vilkar`; content accurately describes data flows/privacy and verified operator/contact; discreet login/help, no family footer. Google Pages authoring remains a separate backlog task. | Candidate includes anonymous DTO, safe runtime config path, page routing/content and copy/login/help links. Private contact values are not initialized publicly. Keep actual values out of Git. | guides037 web checks: 100 tests/build exit 0; six local candidate screenshots under `.local/m3/round13/public-pages-browser/` cover three pages in mobile-light and desktop-dark, reviewed locally. | Public runtime remains R12; no R13 public HTTPS/visual verification. | No; content work is not blocked, private values stay out of Git. |
| R13-12 Google and Microsoft setup | Google guide has five steps covering API/client/callback/Branding/Audience/connection; uses current official docs; states scope of testing vs publishing vs verification; includes exact Branding table and missing owner fields. Microsoft distinguishes installation-owner directory/app registration from calendar-account authorization; supports personal and work accounts; does not guess account-lock cause; cites current free eligibility; never creates an organization. | Google and Microsoft guides and administrator UI implemented; external owner registration/consent, integrated browser checks and live provider verification remain open. | guides037 web checks: 100 tests/build exit 0; five provider-focused checks pass. | One Google connection exists but is not currently connected; `disconnected_at` is null, so do not characterize it as revoked. No live provider verification. | Owner registration/consent may be required for live validation, but guide work is not blocked. |
| R13-13 Traceability, QA and release | Maintain this matrix; synthetic local data; full-target QA, backup/restore, release gate last; feature-only DCO delivery. No PR/merge/main/force push/tag/release/Actions. Report risks/migrations/screenshots/privacy. | Full current QA passes; operations restore/release gate, canonical14 and public deployment/verification remain open. | `.local/m3/round13/qa-final.log`: web141 + contracts5 + core3 + API319 = 468, zero failures; workspace TypeScript checks pass; source proof 308 input hashes. Worker tests discovered 0; no worker behavior coverage claimed. | R12 only; no R13 deployment. | No, except external provider consent. |

## Current verified snapshot — 2026-10-16

The frozen QA snapshot passed 468 tests (web 141, contracts 5, core 3, API
319), zero failures, with all workspace TypeScript checks passing. Its source
proof contains 308 inputs; worker tests discovered zero, so no worker behavior
coverage is claimed. Full QA does not substitute for restore, canonical14,
release gate or deployment.

After the QA snapshot, display source `d91436addb4a55f7b27ae27df549b173fa276fe7`
was DCO-signed and feature-pushed. Root confirmed the 17 source inputs match the
pin. Latest web TypeScript and actual-address browser checks pass, but one
desktop address screenshot was reviewed and accepted. This targeted follow-up is not
a rerun of the 468-test suite. Public and LAN runtime remain R12.

HA source `5b39d4375ff8373657f5bfd3492fa52e842326ea` is DCO-signed/pushed; ten
serialization tests and synthetic-transport UI checks pass. Media browser
authorization/playback was accepted on the isolated fictional fixture. Saved
school-task activation remains pending a real authorized `household.manage`
session, using task origin/subject without impersonation, copied tasks, AI calls
or changes to approvals/schedules. Operations-helper changes passed static
review only. The first isolated restore attempt failed safely before migration
on the deliberately pre-existing `NOT VALID` constraint
`ai_rate_snapshots_nonnegative_rates`; cleanup was verified. Invalid indexes:
128 foreign keys; one canonical unvalidated check constraint; 0 invalid indexes.
This is a restore-gate finding, not a passing
restore. No release operation has been run. Contact values are confirmed
privately and remain absent from Git and public initialization.

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

## Historical guides037 backend checkpoint — superseded by current snapshot above

At this earlier checkpoint, publisher/origin `a887028a4344ebb33b828d44e6a4fa3b44ec90da`
contained T1–T3, Home and display setup/messages packages A+B. Display package B
was DCO signed/pushed. The guides037 combined backend checkpoint passed 52/52
with zero failures/skips/cancellations; see
`.local/m3/round13/backend-guides-checkpoint.log` (isolated runner, actual exit
0, 101.5 seconds). Earlier narrower checkpoints remain historical. This is not
full QA, release-gate or public evidence. Round 12 remains the deployed public
source. Later Home, media, HA and display evidence is recorded in the current
snapshot/status above. Full restore, release gate and public verification remain
open. See the current
status table in
`ROUND_13_STATUS.md`.

The guides037 workspace includes candidate anonymous-page and provider-guide
behavior. Contact values remain private and are not initialized publicly;
public runtime remains R12 pending browser/public verification.
`.local/m3/round13/guides-web-final.log` records 100 web tests and build exit 0;
initial five workspace checks and five provider-focused checks passed. The
independent combined backend run is 52/52 with actual exit 0 and zero
failures/skips/cancellations. These checks do not complete shared UI, full
visual QA, backup/restore or release acceptance.

Native boards A browser evidence and guides037 local page captures are detailed
in `ROUND_13_STATUS.md`. These are synthetic candidate evidence, not public
deployment tests. This historical note predates completed media browser
authorization/playback acceptance and later feature-source pushes; the early
`8e3440a` overlay is not current source identity.

An intermediate default Vite build touched the LAN-bound `dist`; root restored
all ten R12 assets from the immutable R12 image and byte-checked them against
canonical proof `00ddc36`. Existing LAN admin authentication, health and
FamilyHub were verified, and no application data changed. Future intermediate
builds must direct output to `/tmp`, never LAN-bound `dist`. Public and LAN
deployments remain R12.

### Historical Home backend evidence checkpoint

R13 birthday/week/school backend is locally implemented and synthetically tested
(15 passing focused/regression tests; API typecheck pass). Four bounded review
findings were fixed and re-reviewed. Later Home day/source-catalog work,
candidate UI and full synthetic QA are recorded below and in the current
snapshot; saved-school activation and public verification remain open.
Evidence: `.local/m3/round13/home-focused-tests.log` and `home-api-check.log`.
No completion claim applies to the full birthday, school or chronology UX yet.

### Home day/source-catalog checkpoint — 2026-10-16 (initial candidate snapshot)

Source-catalog/API checkpoint `bb7255ccc023ef1f474f1c2632fb05e3718f93c1` and
frontend checkpoint `943bd63c3a2eb23b938ad339a77fbe0546119ac5` are pushed.
Home/all-day evidence is 23/23 (five all-day, eight catalog, five display, five
Home) plus API/contracts checks in
`.local/m3/round13/all-day-strong-final.log`. The previous all-day query fails
four red counterfactuals. The backend is implemented and tested; later full-QA
and focused visual evidence is captured in the current snapshot above.

Frontend spans 14 files and reports 117 web tests/check/tmpbuild. Synthetic
browser checks cover life 503, empty 200 and clear 403. Seven source-built
viewport/theme layouts were root-reviewed; `.local/m3/round13/home-browser/layout.log`
records passing bounds, and no CSS injection was found. Root confirmed the
built snapshot equivalent to commit 943bd63 across 256 runtime files. The
Previously open local-date person-future, school-provenance and C2
metadata/font follow-ups are complete. Saved school task activation still needs
an authorized `household.manage` session and safe classification; integrated
release review, restore and public deployment remain open. Public and LAN
deployments remain R12.

### Historical Display setup backend checkpoint

Reusable setup selection and actual device permissions are separate. Migration
029 preserves old devices and legacy inserts; new pairings copy no device grants.
Scoped assets, source/person narrowing, authority rechecks and invalidations have
passed bounded review. Local complete API (4/4) and Round 9 (5/5) tests pass.
These include strengthened existing tests, not nine newly created test cases.
Display UI, real-browser cookie checks, author/actions and public verification
remain open. See ROUND_13_STATUS.md for exact evidence.

### Historical Display actions/backend integration evidence checkpoint

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

Local media acceptance update: main observed private album creation/upload,
decoded image/reload, two-account explicit grant and revocation (image 200 then
404 and UI clearing), pause across manual/30-second refresh, and Home background
apply/reset. `boards-browser/media-{browser,access}.log` exited 0 against the
dedicated six-person synthetic fixture. Shared display integration, full
responsive acceptance, restore and public proof remain open.
