# Round 13 status — all active requirements registered

Updated: 2026-10-15
Goal: complete all 13 owner-request areas recorded in
`ROUND_13_REQUIREMENTS.md` and `REQUEST_LEDGER.md`.
Phase: temperature backend package implemented and locally tested; remaining packages active.
First implementation package: Home Assistant temperature fixes T1–T3 under
R13-10. These are not the full goal.

## Baseline snapshot and preservation warning

- Canonical publisher Git HEAD is `df04e82`; root Git HEAD `390f6a6` is
  intentionally stale. Do not mistake the checkout metadata difference for a
  source conflict, recreate published work, or send every agent to rediscover a
  false worktree conflict.
- At the start of this round, all 246 working runtime source files independently matched publisher/deployed
  source `00ddc36f74fa41925fc0cc6e9b7e6b462e96a37a`. R13 runtime changes now exist in the root worktree; publisher remains the baseline. Root Git status is historically dirty, not new R13
  work. Recheck the match only after actual runtime edits.
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
| R13-01 | Agent economy and durable status | Registration only | N/A | N/A | No |
| R13-02 | Data/environment preservation | R12 baseline only | No new check | R12 only | No |
| R13-03 | Day overview and birthdays | Household-local calendar preview baseline; existing saved birthday matches owner-reported month/day and household birthday setting is enabled. New presentation open. | No new check | R12 calendar only | No |
| R13-04 | People, week and school cards | Calendar preview/details baseline only | No new check | R12 only | No |
| R13-05 | Waste consolidation | Import/day-plan baseline only; removal open | No new check | R12 only | No |
| R13-06 | Display identity/configuration and per-display projection | No new evidence | No new evidence | R12 ACL paths only | No |
| R13-07 | Permissions and real display author identity | No new evidence | No new evidence | No new evidence | No |
| R13-08 | Messages, private background and shared album | No new evidence | No new evidence | No new evidence | No |
| R13-09 | Durable groceries and dated dinners | No new evidence | No new evidence | No new evidence | No |
| R13-10 | Home Assistant controls and T1–T3 | Read-only temperature baseline only | No R13 evidence | R12 baseline; one existing public HA connection must be preserved | No for isolated fixes; real provider consent is separate |
| R13-11 | Anonymous public information pages | No new evidence | No new evidence | Test origin only | Yes: verified operator/contact facts missing |
| R13-12 | Google/Microsoft setup | No new evidence | No new evidence | One existing Google connection is disconnected; no live provider verification | Live registration/consent may be owner-dependent |
| R13-13 | Matrix, QA, backup/restore and feature delivery | Registration only | No R13 evidence | R12 historical only | No, aside from facts/consent above |

Full acceptance criteria and evidence distinctions are in
`ROUND_13_REQUIREMENTS.md`. None of the new criteria is complete by this
registration. R12 baseline only receives credit for behavior it directly
reports; it does not satisfy newly requested additions.

Current public-state observations are aggregate only: a saved birthday matches
the owner's reported month/day and the household birthday setting is enabled;
one HA connection exists; one Google connection exists and is not currently connected (not revoked).
No person names, dates, provider identifiers, calendar values or sensor values
are recorded. Preserve those connections and state. Do not ask for a generic HA
reconnect.

## Resume sequence

1. Continue the existing goal. Read the complete requirement matrix and active
   mailbox before implementation. Keep all 13 areas in scope, including work
   after the initial T1–T3 package.
2. Preserve the root/publisher/deployed source relationship above. Do not create
   fictitious code conflicts from stale root Git metadata. Keep unrelated work
   intact.
3. Complete bounded read-only reviews in their assigned expertise. Use the
   explicitly selected `gpt-6.1-sol` at high reasoning for the security-critical
   display identity/authorization review. The supplied model record for repo
   scout, requirements, architecture and UX is `gpt-6-luna` at medium/high/high/
   high. Do not guess the main model or model costs.
4. Begin implementation with T1–T3, one writer at a time. Backend owns sensor
   identity, OAuth recovery, polling, API projections and server authorization;
   frontend work follows settled contracts. After that package, continue across
   the remaining active R13 areas in `ROUND_13_REQUIREMENTS.md`. Never declare
   the overall goal complete after temperature fixes alone.
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

Only the public test origin `https://samvev.pabben.org/` is confirmed. No
verified legal operator name or privacy contact was found; public pages requiring
those facts remain owner-blocked, and must not invent them. Provider registration,
consent and source activation are separate from synthetic QA. These dependencies
do not block isolated code work. No R13 tests, captures, backup/restore, build or
deployment were run during requirements registration.

## Temperature checkpoint — 2026-10-15

T1–T3 backend changes are implemented in the root runtime worktree, not yet
committed, built for QA or publicly deployed. The publisher remains `df04e82`.
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
Next sole writer: Home/birthday/week/school backend, after this package freezes.
All other areas in the matrix remain active.

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

The next sequential writer is display13 (gpt-6-luna/high), for reusable display
setups, device-specific pairing and server-filtered read projections. Other
writers remain frozen. This checkpoint does not mark the overall round complete.
