# Round 13 status — all active requirements registered

Updated: 2026-10-16
Goal: complete all 13 owner-request areas recorded in
`ROUND_13_REQUIREMENTS.md` and `REQUEST_LEDGER.md`.
Phase: all 13 areas remain active; public deployment is complete, but overall owner-controlled verification remains open. Current source is
`7c61557b92333408c628911784aff267411479ba`. Immutable full QA at base
`fb08236` passed 485/485 and five workspace checks. The three-file capture-helper
delta passed two actual browser cases and eight helper tests. Predeploy gate and
7c615 public restore passed. Canonical14 round
`20261016061136-7c61557b-3a479144` is complete: all 14 images were root-viewed
and hash-verified; `ux13_final` reviewed visuals, while root and `release13`
verified the set, with 305 inputs, 12 assets and 229 Git checks. Source
`7c61557b92333408c628911784aff267411479ba` is publicly deployed. Cutover and
fresh pre/post-migration restore checks passed; the seven-check HTTPS smoke
passed. The earlier safe preflight refusal while the monitor held a schema-026
lease is historical and resolved by the successful cutover. Contact
configuration is initialized privately and the public contact check passed.
Saved-school activation needs an authorized session but does not block feasible
delivery; the overall goal remains incomplete pending owner-controlled
activation and external provider consent/live verification. Physical-device testing is optional, was not performed, and is not a completion blocker.

## Baseline snapshot and preservation warning

- Publisher/origin feature source is now `7c61557b92333408c628911784aff267411479ba`;
  migrations 033–037 and requested feature packages are in the feature branch.
  Root Git HEAD `390f6a6` is intentionally stale metadata;
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
| R13-01 | Agent economy and durable status | Active status/checkpoint practice recorded. Known writers/reviewers: `gpt-6-luna/high` for economical implementation, `gpt-6.1-sol/high` for bounded security/operations review and `gpt-6-astra/xhigh` for the release gate; coordinator model/cost not asserted. | Local runners and durable checkpoints recorded; no estimated cost | N/A | No |
| R13-02 | Data/environment preservation | User data, vault, schedules, protected root Git and existing admin/runtime preserved. Two default Vite output incidents were restored and hash-checked; future intermediate builds use `/tmp`. | Fresh schema-026 backup restored, forward 037 applied and second-run no-op; fresh schema-037 postdeploy backup restore/no-op; QA-clone restore. Existing columns/values and env/vault/database-volume/runtime identity preserved. | Candidate `7c61557` deployed; bounded HTTPS smoke passed. | No |
| R13-03 | Day overview and birthdays | Birthday/day DTO and all-day boundary backend implemented and focused-tested; Home UI reviewed. Requested birthday, opt-in and household-local date privately verified; no birth year read/inferred and no data changed. | Home/all-day 23/23, API/contracts; seven Home layouts and bounds; full QA 485/485 at immutable fb base plus helper delta checks. | Deployed; smoke navigated Home but did not feature-test birthday presentation. | No |
| R13-04 | People, week and school cards | Bounded Home chronology/school backend and candidate UI. Person-future, school-provenance and C2 metadata/font fixes are complete. Existing saved school tasks need safe authorized activation; this owner-session action does not block feasible delivery. | 117 web tests/check/tmpbuild; life 503, empty 200, clear 403; seven Home layouts; 23/23 backend/API. No impersonation, copies, AI calls, or approval/schedule mutation. | Deployed; Home smoke only, no feature-specific school acceptance. | Owner session needed for existing-task activation; not a cutover blocker. |
| R13-05 | Waste consolidation | Separate Next Waste surface removed; day overview waste icons/import retained. | Included in synthetic candidate QA; no separate test count asserted. | Deployed; not separately validated in public smoke. | No |
| R13-06 | Display identity/configuration and per-display projection | Implemented in current source `7c61557b92333408c628911784aff267411479ba`; open/copy is outside pair dialog and desktop address screenshot accepted. | Focused backend/UI, pairing/default-deny, board ticks/focus, four compact views and address browser pass. Immutable base QA 485/485; helper delta two browser cases/eight tests. | Deployed; public smoke opened the Displays page and separately opened Your settings without mutation. Detailed policies remain synthetic evidence. | No |
| R13-07 | Permissions and real display author identity | Read-only default, real display author identity, recipient/action grants, revocation and explicit display actions implemented and locally exercised; no member impersonation. | Actual UI/API: allowed recipient only; display-authored POST 201 stores real display name with null person ID; revoke removes composer. Six-case composer lifecycle evidence, board ticks/focus and six rendered composer cases. | Public smoke checked `/api/v1/me` and `/api/v1/display/projection` denial and opened **Your settings** only; no public write/action test. | No |
| R13-08 | Messages, private background and shared album | Message/media frontend and authorization/playback browser acceptance passed on synthetic candidate; private backgrounds and shared album flows exercised. | 109 frontend checks plus synthetic-fixture upload/preview/reload, sharing/revocation, pause/refresh and background apply/reset; restore media/ACL/roundtrip validated. | Public smoke did not exercise media or message flows. | No |
| R13-09 | Durable groceries and dated dinners | Native backend and candidate UI support durable boards; bounded browser acceptance and immutable full QA pass. | Native A isolated browser: six synthetic people, grocery add/check/uncheck, two-page sync, dinner assign/reload, option delete/snapshot clear, 503 stale and 403 clear, mobile hit-test; real-HTTP UUID fallback regression fixed. | Public smoke did not exercise board mutations. | No |
| R13-10 | Home Assistant controls and T1–T3 | T1–T3 and selected HA controls implemented; no physical commands run. | Credential serialization regression 10 focused tests; synthetic-transport checks for selection/grants, explicit light/garage confirmation, replay, read-only polling and stale/clear states; five images reviewed. | Existing HA connection preserved; public smoke issued no commands. | No blocker; synthetic transport is the accepted test boundary. Optional physical verification was not performed. |
| R13-11 | Anonymous public information pages | `/om`, `/personvern`, `/vilkar` routing/content, anonymous DTO and safe runtime configuration path implemented; public contact initialized privately. | guides037 web check: 100 tests/build exit 0; six local candidate screenshots; final contact check matched API data to three pages and reloads. | Deployed; all three anonymous routes direct-reloaded, `/api/v1/me` and `/api/v1/display/projection` returned 401, and all 12 asset hashes matched in HTTPS smoke. | No; literal contact values remain private. |
| R13-12 | Google/Microsoft setup | Google and Microsoft guides and administrator UI implemented; external owner registration/consent and live provider verification remain open. | Provider-focused checks and local guides pass. | Setup UI deployed at `/?tab=integrations&setup=google`, `...?setup=microsoft`, and `...?setup=spond`; HTTPS smoke did not perform provider OAuth. Historical database observation: one Google connection was not connected while `disconnected_at` was null; do not call it revoked. | External registration/consent and live validation remain owner-controlled. |
| R13-13 | Matrix, QA, backup/restore and feature delivery | Current source `7c61557b92333408c628911784aff267411479ba`; predeploy gate, canonical14, cutover, pre/postdeploy restore and HTTPS smoke passed. | Immutable `fb08236` QA 485/485, five checks; 7c delta: two browser cases/eight helper tests. Canonical14 round `20261016061136-7c61557b-3a479144`: 14 images, 305 inputs, 12 assets, 229 Git checks. | Public `7c615` is deployed; seven-check smoke passed. | Provider consent and authorized household session for saved-school activation remain owner-controlled; neither blocks completed cutover. |

Full acceptance criteria and evidence distinctions are in
`ROUND_13_REQUIREMENTS.md`. R12 baseline receives credit only for behavior it
directly reports; it does not satisfy newly requested additions. Local backend
checkpoint status is reflected in the table above; it does not imply UI or
public completion. The dated checkpoint sections below preserve earlier evidence; they are historical snapshots and must not override this current matrix. Current public runtime is source `7c61557`; cutover, restore and bounded HTTPS checks passed.

## Current verified snapshot — 2026-10-16

Source `7c61557b92333408c628911784aff267411479ba` is deployed publicly. Immutable QA at base `fb08236` passed 485/485 (web 141, contracts 5, core 3, API 336, worker 0) plus all five workspace checks; the three-file capture-helper delta passed two browser cases and eight helper tests. Predeploy gate and canonical14 round `20261016061136-7c61557b-3a479144` passed (14 images, 305 inputs, 12 assets, 229 Git checks). `ux13_final` reviewed the visuals; root and `release13` checked the input/assets/Git evidence.

Cutover completed at `.local/m3/round13/ops/cutover-20261016T062416Z/` with exit 0. Fresh schema-026 restore, forward migration 037 and no-op passed; fresh postdeploy schema-037 restore/no-op passed. Existing columns/values, runtime, environment, vault and database volume were preserved. HTTPS smoke `.local/m3/round13/public-browser/postdeploy-smoke.log` passed seven checks: anonymous direct reloads, `/api/v1/me` and `/api/v1/display/projection` return 401, 12 asset hashes, retained-account identity, Home/Displays navigation, the separate **Your settings** dialog opens without mutation, and logout. Contact API/page/reload check `.local/m3/round13/public-browser/contact-check-final.private.log` passed. These are bounded checks, not full live acceptance of every feature.

Requested birthday registration, opt-in and household-local date were privately verified; no birth year was read or inferred and no household data changed. Display address screenshot is accepted. Existing saved-school tasks still need activation via an authorized `household.manage` session using actual origin and subject, without impersonation, copying, AI calls or approval/schedule changes. This owner action does not block feasible delivery but the overall goal remains incomplete. Contact values are initialized via private runtime config and are not in Git. External Google/Microsoft consent and live provider verification remain owner-controlled. HA controls remain synthetic-tested; no physical commands or manual model calls were made. Earlier safe cutover-preflight refusal at schema 026 is historical and resolved; no schedules or models were changed.

## Historical checkpoint entries

The dated entries below describe earlier state at their checkpoint date. The current matrix and verified snapshot above supersede any old statement that R13 was undeployed or that public contact setup was pending.

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
