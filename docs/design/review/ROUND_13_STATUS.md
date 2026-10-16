# Round 13 status — all active requirements registered

Updated: 2026-10-16
Goal: complete all 13 owner-request areas recorded in
`ROUND_13_REQUIREMENTS.md` and `REQUEST_LEDGER.md`.
Phase: temperature, Home, display setup/messages, native boards, media,
HA-controls, Display 036 and guides 037 backend/documentation checkpoints are
implemented/reviewed. Shared UI, public contact initialization, provider
wizards, full visual/QA/release and public verification remain open. All 13
areas remain active.

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
| R13-01 | Agent economy and durable status | Active status/checkpoint practice recorded; no cost estimates | N/A | N/A | No |
| R13-02 | Data/environment preservation | Checkpoint preserved baseline; 229 protected root Git hashes independently unchanged at display-message checkpoint | Isolated synthetic runs only | Public R12 runtime remains unchanged | No |
| R13-03 | Day overview and birthdays | Birthday/day DTO backend locally implemented; UI celebration/reduced motion and complete display acceptance remain open | 15 focused Home tests and API check pass | R12 only | No |
| R13-04 | People, week and school cards | Bounded Home chronology, school metadata, and display week/next/person/saved-school ACL chronology backend implemented; full card/week/school UI remains open | Home 15 focused tests/API; Display 036 focused review evidence below | R12 preview/details only | No |
| R13-05 | Waste consolidation | Import/day-plan baseline only; remove separate Next Waste surface remains open | No new evidence | R12 only | No |
| R13-06 | Display identity/configuration and per-display projection | Reusable setup, independent device grants, policy GET, read-only real-device-grant preview and server-filtered projections implemented; UI/browser/config preview remain open. Family layout is independent of external-data opt-in; selection grants no access. | API 4/4, Round 9 5/5, Display 036 15/15 focused plus all five workspace checks; final combined backend checkpoint 42/42, bounded strong review closed | R12 ACL baseline only | No |
| R13-07 | Permissions and real display author identity | Persisted real display authors, per-device recipient/action policy, safe replay and revocation boundaries implemented; UI and public verification open | Final combined backend checkpoint 42/42 pass, zero failures/skips/cancellations; bounded findings closed | No R13 public evidence | No |
| R13-08 | Messages, private background and shared album | Display authors and private album/background backend implemented; message typography, album playback/UI and restore/public acceptance remain open | Media focused 10/10 plus API 4/4; four review findings corrected with deterministic regressions | No R13 public evidence | No |
| R13-09 | Durable groceries and dated dinners | Native backend, revisions/tombstones, snapshots and independent display grants implemented; UI remains open | Focused integration and API/contracts checks pass; lock-expiry review findings closed | No R13 public evidence | No |
| R13-10 | Home Assistant controls and T1–T3 | T1–T3 and selected HA controls backend implemented; device integration/display projection checked. Physical owner verification and UI remain open | HA focused controls 3/3; Display 036 focused expiry/filter suite evidence; final combined backend checkpoint 42/42 pass | R12 read-only baseline; preserve the existing public HA connection | No for isolated work; live consent is separate |
| R13-11 | Anonymous public information pages | `/om`, `/personvern`, `/vilkar` routing/content, anonymous DTO and safe runtime configuration path implemented in candidate; private contact values are not initialized publicly. Browser/public verification remains open. | guides037 web check: 100 tests and build exit 0; initial five workspace checks pass | Public deployment remains R12; no R13 browser/public visual verification | No; values are privately confirmed but must stay out of Git |
| R13-12 | Google/Microsoft setup | Google and Microsoft guides implemented; interactive setup wizards and live provider verification remain open | guides037 web check: 100 tests/build exit 0; provider-focused 5 checks pass | One Google connection exists but is not currently connected; `disconnected_at` is null, so do not call it revoked. No live provider verification. | Registration/consent may be needed for live verification; guide work is not blocked |
| R13-13 | Matrix, QA, backup/restore and feature delivery | Status is updated; full-target QA, recovery, release gate and public rollout remain open | Checkpoints documented; full retest not yet complete | Round 12 remains deployed; R13 public verification absent | No, except explicitly noted live provider consent |

Full acceptance criteria and evidence distinctions are in
`ROUND_13_REQUIREMENTS.md`. R12 baseline receives credit only for behavior it
directly reports; it does not satisfy newly requested additions. Local backend
checkpoint status is reflected in the table above; it does not imply UI or
public completion.

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
