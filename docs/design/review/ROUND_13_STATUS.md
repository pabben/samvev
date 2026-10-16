# Round 13 status — all active requirements registered

Updated: 2026-10-16
Goal: complete all 13 owner-request areas recorded in
`ROUND_13_REQUIREMENTS.md` and `REQUEST_LEDGER.md`.
Phase: all 13 areas remain active. Home, native boards, media and HA have
candidate UI/browser evidence; bounded acceptance and full QA evidence are
recorded below. Remaining work includes saved-school activation through an
authorized household session,
backup/restore, canonical14, release gate and
public deployment/verification. Public and LAN runtime remain R12.

## Baseline snapshot and preservation warning

- HA publisher/origin checkpoint `670f0b3` contains migrations 033–035 and is
  pushed to the feature branch. Display 036 backend changes are the next local
  checkpoint and are not claimed as published here. Root Git HEAD `390f6a6` is intentionally stale metadata;
  do not mistake it for a source conflict, recreate checkpointed work, or ask
  every agent to rediscover a false worktree conflict. The earlier `df04e82` /
  deployed R12 source was superseded by this R13 feature checkpoint.
- At the start of this round, all 246 runtime files matched deployed R12 source
  `00ddc36f74fa41925fc0cc6e9b7e6b462e96a37a`. Newer R13 runtime changes have
  since been committed/pushed to the feature branch. Root Git status remains
  historically dirty; do not treat it as proof of new uncommitted work.
- R12 source: `00ddc36f74fa41925fc0cc6e9b7e6b462e96a37a`; review:
  `fb9998b83ac1d7962edc05747d7982a99f18fcd5`; image:
  `sha256:baa1c70f781ae887a791e52c120a674384f1b9737a6093aee2d1785aa0806a02`;
  round ID `20261015115219-00ddc36f-d69a86e7`.
- R12 reports 374/374 serial tests, five workspace checks/builds, public
  HTTPS/ACL/SSE checks, migration 026 and isolated backup/restore evidence.
  These are historical baseline claims, not Round 13 proof.
- Both guest disk expansions (codex-dev and claude) are complete and verified.
  Do not repeat disk or host work.
- Preserve current user data, photos, calendars, sensor choices, vault,
  permissions, AI tasks/schedules, database volume, LAN admin/runtime and
  protected root Git metadata. No reseed/reset, credential reset, manual model
  calls, live HA failure injection, or physical command tests.

## Progress across the full goal

| ID | Active requirement area | Implemented | Synthetic | Public | Owner-blocked |
|---|---|---|---|---|---|
| R13-01 | Agent economy and durable status | Active status/checkpoint practice recorded. Known writers/reviewers: `gpt-6-luna/high` for economical implementation, `gpt-6.1-sol/high` for bounded security/operations review; coordinator model/cost not asserted. | Local runners and durable checkpoints recorded; no estimated cost | N/A | No |
| R13-02 | Data/environment preservation | User data, vault, schedules, protected root Git and public/LAN R12 runtime preserved. Two default Vite output incidents were restored and hash-checked; no DB/public changes. Future intermediate builds use `/tmp`. | Asset restoration, existing LAN admin/health/FamilyHub checks in current snapshot below | Public and LAN R12 unchanged | No |
| R13-03 | Day overview and birthdays | Birthday/day DTO plus household-local all-day boundary backend implemented and focused-tested; birthday/day UI evidence accepted in candidate, overall integration/public validation open | Home/all-day 23/23 (five all-day, eight catalog, five display, five Home), API/contracts pass; `.local/m3/round13/all-day-strong-final.log`; old query fails four counterfactuals | R12 only; no R13 public deployment | No |
| R13-04 | People, week and school cards | Bounded Home chronology/school backend implemented; candidate birthday/day/week/next/school UI. Previously reported person-future, school-provenance and C2 metadata/font follow-ups are complete. Saved existing school tasks still need safe authorized activation and verification. | 117 web tests/check/tmpbuild; browser life 503, empty 200, clear 403; seven reviewed Home layouts and bounds pass; 23/23 backend/API as R13-03 | R12 only; no public R13 UI | No; activation requires a real authorized `household.manage` session, no impersonation or AI calls |
| R13-05 | Waste consolidation | Separate Next Waste surface removed; day overview waste icons/import retained | Included in synthetic candidate QA; no separate test count asserted | R12 only | No |
| R13-06 | Display identity/configuration and per-display projection | Reusable setup/device grants, policy/projection and setup/profile UI implemented in DCO-signed feature source `d91436addb4a55f7b27ae27df549b173fa276fe7`. Open/copy now sits outside pair dialog. | Focused backend/UI, pairing/default-deny, board ticks/focus, four compact views (164px, Today/Tomorrow/Next, no implicit week); latest web TypeScript and address2 browser pass. Root reviewed and accepted the desktop address screenshot. | R12 ACL baseline only; no public R13 display UI | No |
| R13-07 | Permissions and real display author identity | Read-only default, real display author identity, recipient/action grants, revocation and explicit display actions implemented and locally exercised; no member impersonation | Actual UI/API: allowed recipient only; display-authored POST 201 stores real display name with null person ID; revoke removes composer. Six-case composer lifecycle browser evidence, six board ticks/focus, and 6 rendered composer cases | No R13 public evidence | No |
| R13-08 | Messages, private background and shared album | Message/media frontend and authorization/playback browser acceptance passed on synthetic candidate; backup/restore and public acceptance remain open | 109 frontend tests/check/build and actual album upload/preview/reload, shared ACL/revocation, pause/refresh and background apply/reset reviewed | No R13 public evidence | No |
| R13-09 | Durable groceries and dated dinners | Native backend and candidate UI support durable boards; local browser acceptance covers core flows, but full integrated UI/QA remains open | Native A isolated browser: six synthetic people, grocery add/check/uncheck, two-page sync, dinner assign/reload, option delete/snapshot clear, 503 stale and 403 clear, mobile hit-test; real-HTTP UUID fallback regression fixed | No R13 public evidence | No |
| R13-10 | Home Assistant controls and T1–T3 | T1–T3 and selected HA controls implemented; HA UI and serialization guard are pushed at `5b39d4375ff8373657f5bfd3492fa52e842326ea`. No physical commands run. | Credential serialization regression 10 focused tests; actual synthetic-transport browser checks for selection/grants, explicit light/garage confirmation, replay, read-only polling, 503 stale and 403 clear; all 5 images reviewed | R12 read-only baseline; preserve existing HA connection; no public R13 controls | No live HA authority required for synthetic testing |
| R13-11 | Anonymous public information pages | `/om`, `/personvern`, `/vilkar` routing/content, anonymous DTO and safe runtime configuration path implemented in candidate; private contact values are not initialized publicly. Public verification remains open. | guides037 web check: 100 tests/build exit 0; six local candidate screenshots (three pages × mobile-light/desktop-dark) reviewed | Public deployment remains R12; no R13 HTTPS claim or public verification | No; values are privately confirmed but must stay out of Git |
| R13-12 | Google/Microsoft setup | Google and Microsoft administrator guides/UI implemented; integrated browser/public checks and live provider verification remain open | guides037 web check: 100 tests/build exit 0; provider-focused 5 checks pass | One Google connection exists but is not currently connected; `disconnected_at` is null, so do not call it revoked. No live provider verification. | Registration/consent may be needed for live verification; guide work is not blocked |
| R13-13 | Matrix, QA, backup/restore and feature delivery | Full synthetic QA snapshot passes; backup/restore, canonical14, release gate and public rollout remain open | `.local/m3/round13/qa-final.log`: 468 tests, 0 failures, all workspace TypeScript checks pass; 308 source hashes. Worker tests discovered 0; no worker coverage. Latest display header follow-up has separate web TSC/address browser checks. | R12 remains deployed; R13 public verification absent | No, except external provider consent |

Full acceptance criteria and evidence distinctions are in
`ROUND_13_REQUIREMENTS.md`. R12 baseline receives credit only for behavior it
directly reports; it does not satisfy newly requested additions. Local backend
checkpoint status is reflected in the table above; it does not imply UI or
public completion. The dated checkpoint sections below preserve earlier
evidence; this snapshot and the matrix are authoritative for current status.

## Current verified snapshot — 2026-10-16

The QA run in `.local/m3/round13/qa-final.log` passed 468 tests (web 141,
contracts 5, core 3, API 319), with zero failures and all workspace TypeScript
checks passing. Source evidence is `.local/m3/round13/qa-source-proof.json`
(308 input hashes on the codex-dev exact-project read-only snapshot). The worker discovered
zero tests; worker behavior has no coverage claim. Strong composer evidence
includes six rendered cases and the 141-web-test run. This does not replace
backup/restore, full migration recovery, release gate or deployment evidence.

After that frozen QA snapshot, display layout source was DCO-signed and
feature-pushed as `d91436addb4a55f7b27ae27df549b173fa276fe7`; root independently
confirmed 17 source inputs match the pin. The address control now renders outside
the pairing dialog and the address2 browser log passes, as does the latest web
TypeScript check. Root's review of `admin-address-desktop.png` is still pending;
this narrow follow-up is not represented as a rerun of all 468 tests. No R13
public deployment or capture has occurred.

The HA UI checkpoint `5b39d4375ff8373657f5bfd3492fa52e842326ea` is DCO-signed
and feature-pushed. Serialization has 10 focused tests; synthetic-transport
browser checks and five reviewed images cover selected identity/grants, explicit
light/garage confirmation, replay, read-only polling and stale/denied states.
No live or physical HA command was sent.

Display setup/pairing, protected-photo grant/default-deny, action identity and
revoke, board ticks/focus, lifecycle cases and actual message authorship have
focused backend/browser evidence on feature-pushed source
`d91436addb4a55f7b27ae27df549b173fa276fe7`.
The compact four-screen review passes height 164px and one Today/Tomorrow/Next
presentation without implicit week; appearance review used one permitted person
and an explicit editable-board grant, so it is not proof of default permissions.
At the earlier display-candidate checkpoint, the open/copy control still sat
inside the pairing dialog. It was moved outside and passed targeted TypeScript
and browser checks in the later `d91436a` checkpoint noted above. No display
candidate is public evidence yet.

Operational helper draft fixes passed static review only. The first isolated
restore attempt failed safely before migration on the deliberately pre-existing
`NOT VALID` constraint `ai_rate_snapshots_nonnegative_rates`; cleanup was
verified (128 foreign keys, one canonical unvalidated check constraint, 0 invalid
indexes). Restore is not
passing; no release operation has been executed. A later default Vite build again touched LAN-bound
`dist`; root restored it from the exact R12 app image and confirmed all ten disk
and LAN HTTP asset hashes against canonical `00ddc36`, plus existing LAN admin
login, health and FamilyHub. Private restoration evidence is under
`.local/m3/round13/c2-dist-restoration/`. No DB or public content changed; public
and LAN runtime remain R12. Route intermediate builds to `/tmp`.

## Local candidate UI and browser checkpoints — 2026-10-16

Native boards A has isolated real-browser evidence in
`.local/m3/round13/boards-browser/`: `check.mjs`, `snapshot.json`,
`results/result.json`, `browser.log` and `mobile-input.log`. It exercises
grocery add/check/uncheck, two-page sync, dinner assignment/reload, deleting an
option and snapshot clear, stale 503 and clear 403 states, mobile hit testing,
and six fictional people. A real-HTTP run exposed missing
`crypto.randomUUID`; the secure `getRandomValues` UUID fallback and regression
test are included in the candidate evidence. Root reviewed four actual images
and the mobile four/three-item/form behavior; this is bounded candidate
acceptance, not full app QA.

This was an earlier local candidate checkpoint; newer accepted media evidence
and the current frontend status are recorded in the current snapshot below.
The guide pages have six actual local-browser screenshots under
`.local/m3/round13/public-pages-browser/` (three anonymous pages × mobile-light
and desktop-dark), reviewed against the candidate. This makes no public HTTPS
or deployed-page claim. Media frontend checks in `frontend-media-*.log` report
109 tests/check/build pass. Browser authorization and playback review passed
on the synthetic candidate; full deployment/restore remain open.

Operational correction: an intermediate default Vite build wrote to the
LAN-bound `dist`. Root restored all 10 R12 assets from the immutable R12 image,
byte-checked them against canonical proof `00ddc36`, and verified existing LAN
admin authentication, health and FamilyHub. No application data changed. All
future intermediate builds must use a `/tmp` output directory; do not build to
the LAN-bound `dist`.

None of these candidate checkpoints updates public or LAN deployments: both
remain R12. This earlier checkpoint's open review items are superseded by the
current verified snapshot above; backup/restore, release gate and public
deployment remain open.

## Home day, source-catalog and candidate UI checkpoint — 2026-10-16

Backend source-catalog/API checkpoint `bb7255ccc023ef1f474f1c2632fb05e3718f93c1`
and frontend checkpoint `943bd63c3a2eb23b938ad339a77fbe0546119ac5` are pushed.
The frontend spans 14 files for birthdays, day/week/next, school and source
catalog. Home/all-day backend evidence is 23/23: five all-day tests, eight
catalog, five display and five Home, with API/contracts checks passing.
`.local/m3/round13/all-day-strong-final.log` records the run; the older all-day
query fails four red counterfactuals. Later full-QA evidence is recorded above.

Frontend web validation reports 117 tests/check/tmpbuild. Root browser checks
cover life 503, empty 200 and clear 403 behavior. Seven source-built viewport/
theme layouts were reviewed; the bounds log passes and no CSS injection was
found. Earlier layout defects were corrected after CSS-specificity review.
Root verified the built snapshot is equivalent to frontend commit 943bd63
across 256 runtime files. This remains candidate evidence, not full visual or
integrated acceptance.

The prior local-date person-future presentation, school-provenance disclosure
and C2 presentation metadata/font follow-ups have since been completed. Saved
school-task activation still requires a real `household.manage` session and a
safe audited task update; do not impersonate, copy tasks, call AI, or alter
approval/schedule state. HA/display UI and display final browser/type review,
canonical14, restore, release gate and public deployment remain open. Public
and LAN runtimes remain R12. No live Google/Microsoft verification or new HA
action is claimed.

## Guides 037 backend and documentation checkpoint — 2026-10-16

The guides package adds runtime-backed anonymous public-page content and a
safe three-field contact DTO, bootstrap CLI, early `/om`, `/personvern` and
`/vilkar` routing, and actual copy plus discreet login/help links. It includes
the five-step Google guide for configured origin, exact domain, Branding vs
Audience, and testing/publishing/verification scope; Microsoft guide content
distinguishes app-registration owner from calendar-account authorization.
Contact values remain private and are not initialized on the public deployment.

Writer checkpoint: `.local/m3/round13/guides-web-final.log` records web checks
(100 tests) and build with exit 0; initial five workspace checks and five
provider-focused checks passed. Bounded strong review repaired school expiry
after waits and a contact/photo FK deadlock; three counterfactual regressions
reproduced the defects, final verification is 8/8, and exact source restoration
is recorded in `.local/m3/round13/contact-presentation-strong-final-verification.log`
and adjacent restoration evidence. Root independently matched the source hash.
The independent backend checkpoint `.local/m3/round13/backend-guides-checkpoint.log`
passed 52/52 with no failures, skips or cancellations, isolated local runner,
101.5 seconds, actual process exit 0.

This checkpoint does not establish public deployment, browser or visual
acceptance, contact initialization, full shared-card/Home/display UI, backup/
restore, or release-gate completion. Public runtime remains R12.

Current owner/public-state observations are aggregate only: a saved birthday
matches the owner's reported month/day and the household birthday setting is
enabled; one existing HA connection must be preserved; one Google connection is
not currently connected and has `disconnected_at` null (not revoked). No person
names, dates, provider identifiers, calendar values or sensor values are
recorded. Preserve state; do not ask for a generic HA reconnect or describe the
Google connection as revoked.

## Resume sequence

1. Continue the existing goal. Read the complete requirement matrix and active
   mailbox. Keep all 13 areas in scope; temperature, Home and display backend
   checkpoints are not goal completion.
2. Preserve the root/publisher/deployed source relationship above. Do not create
   fictitious code conflicts from stale root Git metadata. Keep unrelated work
   intact.
3. Complete bounded read-only reviews in their assigned expertise. Use the
   explicitly selected `gpt-6.1-sol` at high reasoning for the security-critical
   display identity/authorization review. The supplied model record for repo
   scout, requirements, architecture and UX is `gpt-6-luna` at medium/high/high/
   high. Do not guess the main model or model costs.
4. Continue with one writer at a time. T1–T3, Home birthday/week/school backend,
   reusable display setup/projection, and display-message authorization have
   documented local checkpoints. The next packages still need UI integration,
   media/photo lifecycle, grocery/dinner, HA controls, public pages and Google/
   Microsoft guides/wizards. Preserve their settled backend contracts and do not
   claim frontend/public completion from backend tests.
5. QA adds meaningful synthetic regressions and performs a complete applicable
   retest after confirmed fixes. Use fictional identities/data; keep owner-only
   consent and private data out of fixtures and public artifacts.
6. Run post-implementation security, requirements and UX reviews; route
   confirmed findings to one writer at a time. Release gate runs last. The main
   agent independently checks data preservation, provenance, migration/recovery,
   privacy and release claims.
7. Publish only through the already authorized feature workflow after the full
   required verification. Use DCO sign-off and feature branch only. No PR,
   merge, main/force push, tag/release or Actions dispatch.

Writers share a workspace: do not revert others' edits. Update this status as
work lands, with each area marked implemented/synthetic/public/owner-blocked and
evidence links. Keep unresolved work visible and the goal active until all
requirements are delivered or explicitly resolved.

## External facts and remaining evidence

The public test origin is `https://samvev.pabben.org/`. At initial registration
operator/contact facts were unknown; the owner has since confirmed the required
public contact values privately. Do not put those values in Git; runtime
configuration and pages are still pending. Provider registration, consent and
source activation remain separate from synthetic QA. No R13 tests, captures,
backup/restore, build or deployment were run during the original requirements
registration; later backend checkpoint evidence is recorded below.

## Initial temperature checkpoint — 2026-10-15 (superseded)

At this checkpoint T1–T3 backend changes were in the root runtime worktree, not
yet committed, built for QA or publicly deployed. They are now included in the
current publisher/origin checkpoint recorded above.
Additive migration 027 retains the HA origin binding. Main independently compared
all old migrations 001–026 byte-for-byte with the publisher: unchanged.

Local Compose runner, isolated `test-db/samvev_test`:

- New regression suite: **7/7 pass**, `.local/m3/round13/temperature-green-final.log`.
- Existing calendar-provider, Round 12 calendar and HA-client regressions:
  **16/16 pass**, `temperature-existing-focused-regressions-final.log` in that directory.
- API `tsc --noEmit`: pass, `temperature-api-check.log`.
- Initial tests reproduced the old defects. A separate security regression
  reproduced repeated-selection bypass (HTTP 200 instead of 409) before repair.

Main reviewed the actual logs, projection ACL intersection, origin-binding delta,
revision invalidation and migration preservation. A stronger bounded reviewer
identified origin reapproval and late-response races; these were routed back to
the sole writer. Changed/unknown origin now requires preview and explicit enable;
same-origin recovery keeps existing active choices. No live failure injection,
physical HA action, public deployment or ordinary QA database change was made.

Remaining temperature work: localized recovery explanations, integrated UI and
SSE/revocation verification, complete final tests and public candidate validation.
This checkpoint does not complete R13-10's separate HA-control requirements.
Home and display backend checkpoints have since landed; all other remaining
areas in the matrix remain active.

## Actual delegated model selections

| Agent | Requested model / reasoning | Work |
|---|---|---|
| scout13 | gpt-6-luna / medium | Initial bounded repository review |
| requirements13 | gpt-6-luna / high | Requirement registration and correction |
| architect13 | gpt-6-luna / high | Initial architecture review |
| ux13 | gpt-6-luna / high | Initial visual review |
| temperature13 | gpt-6-luna / high | Temperature implementation and regressions |
| home13 | gpt-6-luna / high | Next backend package preparation |
| guides13 | gpt-6-luna / high | Public pages/provider guide preparation |
| boundary13 | gpt-6.1-sol / high | Bounded security architecture and race review |

Explicit model overrides used fresh, short task contexts. Writers are sequential.
The main agent's precise model variant and monetary costs are not exposed here;
no model switch or estimated saving is claimed. Goal usage counters can be
reported as supplied by the tool at delivery, separately from unavailable costs.

## Home backend checkpoint — 2026-10-15

Birthday today/tomorrow DTOs, bounded household/person chronology and next-event
queries, and explicit school presentation metadata are implemented locally.
Migration 028 is additive; saved task approvals and schedules remain unchanged.
School expiry is preserved for unchanged dates and recalculated for a real date
change. Provenance comes from the saved event fingerprint; existing reader ACLs
still govern visibility. Household-only events retain household attribution.

Main inspected the actual focused test log and assertions: **15/15 pass** on the
local isolated Compose runner (`.local/m3/round13/home-focused-tests.log`), with
API typecheck passing (`home-api-check.log`). A bounded gpt-6.1-sol/high re-review
closed four findings after repairs by the gpt-6-luna/high writer. No model calls,
real task changes, frontend rendering, screenshot capture or deployment were
performed for this package. Frontend integration and full acceptance remain open.

At that historical checkpoint, display13 was the next sequential writer for
reusable display setups, device-specific pairing and server-filtered projections.
That backend work and its display-message follow-up are now recorded in the later
checkpoint sections below. The overall round remains incomplete.

## Display setup backend checkpoint — 2026-10-15

Temperature/Home checkpoint `ac95609ff0d77dcb9dfbc6e13a9d8dc5a50d4a3b`
was DCO-signed and pushed only to the feature branch with `[skip ci]`. The public
app remains the Round 12 candidate. Main verified 229 protected root Git file
hashes unchanged and migration files 001–028 identical to that checkpoint.

Display package A adds migration 029, reusable setup CRUD, independent paired
devices, per-device profile/birthday grants, selected source/person projections,
scoped image routes, transactional authority rechecks and SSE invalidation.
No device permissions follow a reused setup. Existing pairing/insert paths get
compatible presentation defaults. Album/background selections fail closed until
the media package supplies real storage and access rules. The screen UI, true
display authorship and optional actions are still pending.

Writer: display13, explicitly gpt-6-luna/high. Bounded reviewer and subsequent
test repair: boundary13, explicitly gpt-6.1-sol/high. Main inspected the actual
source predicates, shared photo authorization and final logs. Six review
findings were repaired and re-reviewed. Repeated test-fixture failures were
escalated to the stronger agent: global item queries were bound to durable
source/connection/item identifiers instead of weakening assertions.

Local isolated Compose test runner, serial:
- Complete API integration: 4/4 pass,
  `.local/m3/round13/display-strong-api-attempt1.log`.
- Complete Round 9 integration: 5/5 pass,
  `.local/m3/round13/display-strong-round9-final.log`.
- API typecheck: pass,
  `.local/m3/round13/display-strong-api-typecheck-final.log`.

These are existing suites with additional assertions. They cover stored-photo
isolation, conditional-response denial after grant revocation, legacy asset
route denial, independent device revocation, a blocked-write/session-revocation
race and same-connection calendar narrowing independent of person filtering.
Browser cookie-path behavior, final combined regression and public tests remain
open. No physical HA commands, model calls, ordinary QA data changes, deployment
or Actions dispatch occurred in this package.

## Display messages checkpoint — 2026-10-15

Display setup checkpoint `da2075c` was DCO-signed and feature-pushed. Package B
adds additive migration 030, persisted display authors and sender-name snapshots,
per-device action policy/recipient grants, restricted message creation and
minimal replay acknowledgements. No setup selection grants actions; new devices
remain read-only. Other action flags are primitives, not completed grocery,
media or physical-control functionality.

Writer display13 used gpt-6-luna/high; boundary13 used gpt-6.1-sol/high for a
bounded review. Three findings (private edited-body replay, mutual-send lock
ordering, expiry during waits) were repaired and re-reviewed closed. Main read
critical storage/action paths and ran the combined backend suite independently.

Final local isolated Compose test runner evidence:
- **20/20 pass**, no failures/cancellations/skips,
  `.local/m3/round13/backend-display-checkpoint.log` (API, Round 9, display
  messages, Home and temperatures; serial, bounded named test container).
- Dedicated display-message test passes with multiple security/concurrency
  assertions, `display-message-final-rerun.log`; API typecheck passes,
  `display-message-typecheck.log` in the same private evidence directory.
- Two abandoned containers from earlier cancelled test CLI invocations were
  identified by exact project/service/commands and stopped. The final combined
  run used one owned container with explicit cleanup; no QA/public resource was
  stopped or reset.

Older member-only author joins can omit new display-authored rows. Recovery must
retain a compatible reader or deploy a forward fix; never rewrite author history
or automatically restore an old database. Public migration/restore and release
verification remain pending. No public deployment has occurred in Round 13.

Owner contact values have now been explicitly confirmed and stored in private
installation preparation, not Git. Their runtime/public-page wiring remains
pending; external Google/Microsoft console and consent steps are still separate
owner actions. No secret or real household data was added to this checkpoint.

## Native household boards checkpoint — 2026-10-16

Additive migration 031 stores groceries, reusable dinner options and unique dated
dinner snapshots independently of imported calendar items. All current household
viewers, including child members, can edit; actual display devices require
separate read grants, selected cards and explicit action permissions. Revisions,
tombstones and actor-scoped idempotency protect concurrent edits and retries.
Cleared dates retain revision metadata so reload followed by a new dinner works.

The bounded stronger review found late session/device expiry during lock waits
and an incomplete clear/reassign assertion. Both are corrected and reviewed:
final transaction authority checks roll back expired writes/receipts/grant edits;
tests use real database lock barriers and a newly selected dinner option. Focused
integration plus API/contracts typechecks pass in the isolated local Compose
runner (`.local/m3/round13/board-review-fixed.log`). Main inspected the critical
code and assertions; migrations 001–030 remain byte-identical to the publisher.
UI, integrated visual review and public deployment remain open. Native boards
need a compatible reader after migration; do not remove their rows during image
recovery or treat old images that omit them as complete feature rollback.

Main independently reran the combined backend checkpoint on 2026-10-16:
**21/21 pass**, no failures/skips/cancellations, isolated local Compose test runner.
Evidence: `.local/m3/round13/backend-board-checkpoint.log` (actual exit 0).
This includes native boards plus existing API, Round 9, display-message, Home
and temperature regressions. Frontend/media/HA controls/pages/release remain open;
public deployment is still R12.

## Private media backend checkpoint — 2026-10-16

Additive migration 032 stores oriented, EXIF-free, aspect-preserving WebP master
and preview variants in PostgreSQL. No original upload is retained. Private
albums have explicit member/household grants; per-device grants are additional
to setup selection and upload action policy. Background selection does not share
its source album. Default limits are 250 assets/500 MiB per household, input
10 MiB/40 MP/12,000 px edge, master 2,560 px and preview 720 px. Unsupported
decoders return localized photo errors. Album playback interval/pause remains
frontend work, not a persisted feature of this backend checkpoint.

The economical writer implemented the package. Main early review corrected
credential binding, album sharing authority, quota accounting/cascades and
projection completeness. A bounded `gpt-6.1-sol` high review/repair then corrected
replacement preflight, final member-image expiry and two lock-order cycles.
Regression barriers use actual PostgreSQL waits, distinct actors, concurrent
last-slot quota competition and device credential rotation during normalization.
The old lock ordering reproduced failures before the fixed source was restored.
Local evidence: `media-strong-final-regressions.log` **14/14**, API/contracts
typechecks pass, and `media-strong-lock-order-counterfactual-red.log`, all under
`.local/m3/round13/`. No real images or credentials were used.

Public deployment still requires the final source-bound build, isolated restore
and a second candidate dump/restore proving normalized media bytes and ACLs.
Keep the migrated database and use a compatible/forward image recovery; do not
drop new media or restore an old database over subsequent uploads automatically.
Frontend integration, visual controls and public verification remain open.

Main media integration checkpoint (2026-10-16): **31/31** serial tests pass,
actual exit 0, no failures/skips/cancellations, isolated local Compose runner.
Evidence `.local/m3/round13/backend-media-checkpoint.log`. Migrations 001–031
remain unchanged. All 229 baseline protected root Git hashes are unchanged.
This is a backend checkpoint; UI/HA controls/pages/restore/release and public
acceptance remain open. Public runtime is still R12.

## HA controls backend checkpoint — 2026-10-16

Migrations 033–035 add explicit selected registry/device/origin identities,
per-person/device read and fixed-action grants, single-use garage confirmation,
and durable non-retrying dispatch receipts with absolute deadlines. Manager
configuration/reselect/pause APIs preserve saved grants; selection does not
grant access. Changed origins require explicit reselection. Browser clients
never receive the HA credential or a generic service-call endpoint.

`gpt-6-luna` high implemented the package. Bounded `gpt-6.1-sol` high review
identified final authorization/deadline waits, late WebSocket send, grant lock
inversion and cross-origin consent gaps. These were repaired and reviewed.
Stronger bounded test repair then fixed fixture defects and the confirmed
PG42702 ambiguous sensor revision in the existing provider-origin-change path.
The prior grant lock order fails a real database deadlock-counter assertion;
the corrected control service was restored byte-identically afterward.

Local isolated evidence under `.local/m3/round13/`:
- `ha-control-strong-final-verification.log`: actual exit 0, migrations,
  API/contracts typechecks, 2 real synthetic WebSocket tests and 1 comprehensive
  control integration test pass (3/3).
- `ha-control-strong-grant-counterfactual-red.log`: former lock ordering fails.
- `ha-control-strong-counterfactual-restoration.log`: source restoration proof.

No real lights/garage commands were sent. HA-reported state is not physical
confirmation. An external HA administrator can change the registry after the
last check; Samvev cannot make its database and HA administration atomic.
No offline queue or restart resend is implemented. Keep migrated data and use
compatible forward recovery; do not delete receipts/grants on image recovery.
All 229 protected root Git files and published migrations 001–032 were checked
unchanged. Public runtime remains R12. HA UI/physical owner verification and
complete release acceptance remain open.

Do not run `scripts/m1.sh qa-test` unchanged: it resets the retained LAN QA
volume. Final browser acceptance must use separately isolated synthetic data
and preserve the existing QA database and admin/admin.

Main independently reran the integrated backend checkpoint: **37/37 pass**,
actual exit 0, no failures/skips/cancellations, local isolated Compose runner.
Evidence: `.local/m3/round13/backend-ha-checkpoint.log`. This includes existing
HA wire, API/Round 9, display messages, Home, temperature, native boards and
media regressions plus new controls. This is not final frontend/public proof.

## Display 036 backend completion — 2026-10-16

Display backend now includes policy GET and read-only previews filtered by the
real device's current grants, with protected photo/media access and draft
filters. New-message projections are bounded to 14 cards. Device week/next,
person and saved-school chronology respects ACLs. These are backend projection
and policy capabilities; display setup, browsing and card UI remain open.

Cheap-writer implementation and bounded strong review/repair are complete. The
review repairs covered stale photo grants, draft-filter mismatches, final expiry
and privacy checks, plus manager/device lock ordering. The old lock ordering
counterfactual reproduces HTTP 500; the exact corrected source was restored.
Evidence under `.local/m3/round13/`: `display-expiry-check.log` reports all five
workspace checks exit 0; `display-lock-strong-final-verification.log` covers API
and contracts typechecks plus 15/15 display/media/image tests. The lock-order
counterfactual and restoration logs are retained beside them.

The earlier main 41/41 combined run is historical. The final combined backend
checkpoint `.local/m3/round13/backend-display-accepted-checkpoint.log` passed
42/42 with zero failures, skips or cancellations, using the isolated local
runner in 81.8 seconds (actual process exit 0). This verifies backend only; no
display UI, visual capture, public deployment, public restore or full release
acceptance is implied here.

## Native boards and media browser acceptance — 2026-10-16

Main independently exercised the frozen frontend candidate against dedicated
`samvev_r13_boards_fixture` data, with six fictional people and no worker or
external provider calls. `boards-browser/media-browser.log` and
`boards-browser/media-access.log` both exited 0. Actual album creation, synthetic
PNG upload/decoded preview, reload persistence and mobile layout passed. A
second synthetic account could read an explicitly shared image (200); removing
its grant returned 404 for the same image URL and removed the image from its UI.
Playback pause and image selection survived manual and 30-second refreshes.
Household background application and reset were observed in the actual Home UI.
Two additional media screenshots were visually reviewed by main. Evidence is
under `.local/m3/round13/boards-browser/`, including snapshot hashes and
`results/media-access-result.json`.

This is local candidate acceptance, not public or full display acceptance.
Repeated browser logins reached the normal 429 limit; only login buckets in the
dedicated synthetic fixture were cleared for subsequent scenarios. Runtime rate
limits, retained QA data and public data were not modified. Adapter/browser
review fixes include keyed household/device scopes, revocation clearing, honest
transient errors, preserved playback state, readable mobile inputs and the HTTP
LAN secure UUID fallback. Web checks and 109 tests pass; intermediate builds
remain confined to `/tmp`. Full integrated QA, canonical screenshots, restore,
release gate and public test deployment remain pending.
