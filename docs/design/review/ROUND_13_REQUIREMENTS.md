# Round 13 — active requirement and evidence matrix

Registered 2026-10-15 from the current owner request and the copied
`NEXT_CODEX_PROMPT.md`. **All R13-01 through R13-13 requirements are active in
the current goal.** T1–T3 are the first implementation package within R13-10;
they are not the whole goal. The other requirements remain active and must be
implemented or explicitly resolved before the goal is complete.

The matrix below is the current status snapshot. Historical dated checkpoints
remain useful as evidence for their time, but do not override the current rows.
Public deployment completed for source `7c61557`; public evidence in the matrix is limited to the specific smoke checks listed. It does not imply live provider, physical HA, or feature-specific mutation acceptance.

## Acceptance and evidence matrix

`No new evidence` means the requirement is unimplemented/unverified in this
round. `R12 baseline` identifies directly reported older behavior only; it does
not satisfy the new acceptance criteria. Owner-blocked facts must be resolved
without inventing them.

| ID | Granular acceptance criteria | Implemented | Synthetic evidence | Public evidence | Owner-blocked |
|---|---|---|---|---|---|
| R13-01 Agent operations | Record actual agent/model choices and reasoning settings; do not estimate costs without verified pricing; use local runners and durable checkpoints/status; sequence writers on shared files; keep reviews bounded to their roles. | Economical writers used `gpt-6-luna/high`; bounded security/operations reviewers used `gpt-6.1-sol/high`; release gate used `gpt-6-astra/xhigh`. Coordinator model and costs are unasserted. | Checkpoints and exact synthetic evidence paths in ROUND_13_STATUS; no cost estimates. | N/A. | No. |
| R13-02 Preservation | Preserve current user data, vault, AI tasks/schedules, root Git metadata and LAN admin/runtime. No reseed, reset, disk work, broad cleanup or loss of newer owner writes. Keep secrets/private data out of artifacts. | Data/vault/schedules/root Git and existing runtime preserved; two Vite output incidents were restored/hash-checked; future intermediate builds use `/tmp`. | Fresh 026 restore→037/no-op, fresh postdeploy 037 restore/no-op, QA clone restore; existing values, env/vault/database-volume/runtime identity preserved. | Public `7c61557` deployed; bounded HTTPS smoke passed. | No; disk work is complete. |
| R13-03 Day overview and birthdays | Show today/tomorrow in household local time; birthday presentation with subtle balloons/reduced-motion, multiple birthdays, no age inference; update at local midnight. | Birthday/day UI and all-day backend implemented; requested birthday/opt-in/local date privately verified; no birth year read/inferred and no data changed. | Home/all-day focused 23/23, API/contracts, seven layouts and full QA 485/485. | Deployed; public smoke reached Home but did not independently validate birthday rendering. | No. |
| R13-04 People, week and school items | Person-card preview is only today/tomorrow; person details retain future chronological activities. Quiet cards avoid repeated empty copy/CTA. Current/next week with paging and optional exactly one selected next event. School items only on actionable subject/person cards; expire at known school end time that day, else 13:00 local that relevant date; future prep uses its date; unchanged source cannot resurrect; history remains; no family table or AI calls. Honest card height/empty/error states. | Candidate/backend implemented; person-future, school-provenance and presentation/font fixes complete. Existing saved school tasks need authorized `household.manage` activation using real origin/subject, without impersonation/copies/AI/approval/schedule changes; does not block deployment. | Home synthetic layouts/bounds and full QA. | Deployed; public smoke only navigated Home, not school feature acceptance. | Owner session needed to activate existing tasks; not cutover blocker. |
| R13-05 Waste | Remove separate Next Waste; retain day waste icons and import; optional selected next-event belongs to R13-04. | Separate surface removed; day icons/import retained. | Included in synthetic candidate QA. | Deployed; not separately validated in public smoke. | No. |
| R13-06 Display identity/configuration | Open/copy existing display URLs without URL secrets; pair/revoke devices individually; reuse one display setup without duplicate config. Family layout independent of external-data opt-in; layout never grants access. Per-display preview configures cards/order/people/sources/temp/background/theme/language/actions; server ACL and image-cache isolation. | Implemented in `7c61557b92333408c628911784aff267411479ba`; address screenshot accepted. | Focused setup/pair/default-deny, grants, identity/revoke, board actions and compact layouts; immutable QA 485/485 and helper delta. | Deployed; public smoke opened the Displays page and separately opened Your settings without mutation; detailed authorization evidence is synthetic. | No. |
| R13-07 Permissions | Read-only default; optional message author is stored real display identity with restricted recipients, never member impersonation. Grocery/dinner/photo/HA rights are separate; display write requires server-enforced explicit grant. | Display authorization, actual display author, grants/revoke/actions implemented. | Allowed-recipient POST stores display identity and null person ID; revocation removes composer; lifecycle/UI focused checks. | Public smoke checked privacy/settings only; no public write/action test. | No. |
| R13-08 Messages and media | Readable message/avatar/handwriting/emoji; match reference `23_52`; Samvev identity/no family footer. Private background upload/reset; shared album slow loop/pause, mobile rotation, resize/quotas/GPS stripping, backup/delete/ACL. | Synthetic frontend/media flows and authorization/playback reviewed. | Upload/preview/reload, grants/revocation, pause/refresh, apply/reset and restore/roundtrip. | Public smoke did not exercise media/messages. | No. |
| R13-09 Grocery and dinner | Durable concurrent grocery add/check/undo/delete for authorized members; dated emoji dinners without duplicates; display write only with explicit grant. | Backend/UI bounded acceptance and full QA. | Six-person synthetic browser: add/check, sync, dinner/reload, deletion, stale/403 states and mobile target. | Public smoke did not exercise board mutations. | No. |
| R13-10 Home Assistant and T1–T3 | Selected temperature/light/garage only through backend allowlists; per-person/display grants, freshness/errors, garage confirmation; no auto-test/physical command/offline queue; Shelly through HA; also T1–T3. | T1–T3 and selected controls implemented; no live physical command. | Serialization regression and synthetic-transport browser checks for selection/grants, explicit controls, replay and stale/clear states. | Existing HA connection preserved; public smoke issued no commands. | No blocker: synthetic transport is accepted; optional physical verification was not performed. |
| R13-11 Public information pages | Anonymous `/om`, `/personvern`, `/vilkar`; accurate data flows/privacy/operator contact; discreet login/help and no family footer. Google Pages stays separate backlog. | Pages, anonymous DTO and runtime settings implemented; contact initialized privately. | Six local page captures; final contact check matched API fields to all pages and reloads. | Deployed; three routes direct-reloaded, anonymous `/api/v1/me` and `/api/v1/display/projection` returned 401, all 12 asset hashes matched. | No; literal contact values remain private. |
| R13-12 Google and Microsoft setup | Google 5-step API/client/callback/Branding/Audience/connection guide, current docs, exact Branding fields and test/publish/verify distinctions. Microsoft owner-directory/app vs account auth, personal/work support, no guessed lock cause/org creation; current free eligibility. | Admin guides/setup UI implemented; external registration/consent and live provider verification remain open. | Provider-focused checks and local guide review. | UI deployed at `/?tab=integrations&setup=google`, `...?setup=microsoft`, `...?setup=spond`; HTTPS smoke did not perform OAuth. Historical Google state was not connected with null `disconnected_at`; not revoked. | Owner registration/consent for live validation. |
| R13-13 Traceability, QA and release | Matrix, synthetic fixtures, full target QA, restore/release gate; feature-only DCO delivery. No PR/merge/main/force push/tag/release/Actions. Capture risks/migrations/privacy. | Source `7c61557b92333408c628911784aff267411479ba`; predeploy gate, canonical14, cutover, restores and HTTPS smoke passed. | Immutable base QA 485/485 plus five checks; helper delta two browser cases/eight tests; canonical14 14 images/305 inputs/12 assets/229 Git checks. | Public deployed at source `7c61557`; seven-check HTTPS smoke passed. | External provider consent and saved-school owner activation remain; neither blocked cutover. |

## Current verified snapshot — 2026-10-16

Source `7c61557b92333408c628911784aff267411479ba` is deployed publicly. Immutable QA at base `fb08236` passed 485/485 (web 141, contracts 5, core 3, API 336, worker 0) plus all five workspace checks; the three-file capture-helper delta passed two browser cases and eight helper tests. Predeploy gate and canonical14 round `20261016061136-7c61557b-3a479144` passed (14 images, 305 inputs, 12 assets, 229 Git checks). `ux13_final` reviewed visuals; root and `release13` verified input/assets/Git evidence.

Cutover completed at `.local/m3/round13/ops/cutover-20261016T062416Z/`. Fresh schema-026 restore, forward 037/no-op and fresh postdeploy schema-037 restore/no-op passed; existing data, columns/values, runtime, env, vault and database volume were preserved. Migrations 027–037 use forward recovery; do not restore an older image/database over newer writes. The seven-check HTTPS smoke `.local/m3/round13/public-browser/postdeploy-smoke.log` passed anonymous direct reloads, privacy 401, all 12 asset hashes, retained-account identity, Home/Displays navigation, no-mutation Your settings dialog and logout. Contact API/page/reload check passed. This is bounded smoke, not full live acceptance of every feature.

The requested birthday registration, opt-in and household-local date were privately verified; no birth year was read/inferred and no household data changed. Saved-school task activation still requires a real authorized `household.manage` session using actual origin and subject; this is a follow-up that does not block feasible delivery. External provider consent/live verification remain owner-controlled. Physical HA commands were not performed; synthetic transport is the accepted boundary, and physical verification is optional rather than a completion blocker. Contact values are initialized via private runtime config and remain absent from Git. The earlier safe monitor-lease preflight refusal is historical; the later cutover succeeded without schedule or model changes.

## First implementation package: temperature T1–T3

This was the first implementation package within the full active 13-area goal, not a scope replacement.

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
