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
| R13-01 Agent operations | Record actual agent/model choices and reasoning settings; do not estimate costs without verified pricing; use local runners and durable checkpoints/status; sequence writers on shared files; keep reviews bounded to their roles. | No new evidence. | No new evidence. | N/A. | No. The supplied model record covers repo scout, requirements, architecture and UX only; do not infer the main model. |
| R13-02 Preservation | Preserve current user data, vault, AI tasks/schedules, root Git metadata and LAN admin/runtime. No reseed, reset, disk work, broad cleanup or loss of newer owner writes. Keep secrets/private data out of artifacts. | R12 reports preserved data/vault and completed expansions; no R13 preservation check yet. | No new evidence. | R12 only. | No. Disk work is already complete; do not repeat it. |
| R13-03 Day overview and birthdays | Show today's/tomorrow's day overview in household local time; birthdays due today/tomorrow with subtle balloons; honor reduced-motion; support multiple birthdays; never infer age. Midnight changes update without forced reload. | R12 baseline: household-local Today/Tomorrow calendar preview. Current public state has a saved birthday matching the owner's reported month/day and household birthday setting enabled; no date/name recorded. New birthday presentation is unimplemented. | No new evidence. | R12 calendar baseline only. | No. |
| R13-04 People, week and school items | Person-card preview contains only today/tomorrow items; person details keep all fetched future activities in chronological date groups. Quiet cards do not repeat empty messages or redundant CTAs. Provide current/next-week views with paging and optional exactly one explicitly selected next event. School results appear only on actual actionable subject/person cards; expire at a known school end time on that relevant day, otherwise at 13:00 on the relevant date in the household timezone; future preparations use their own dates; unchanged source cannot resurrect expired items; details/history remain available; results stay off family table; presentation/subject edits make no AI calls. Card heights reflect content and empty/error states are honest. | Partial R12 baseline only for calendar preview/details. All listed deltas unimplemented. | No new evidence. | R12 calendar baseline only. | No. Do not treat cutoff as school-year end. |
| R13-05 Waste | Remove separate Next Waste surface. Preserve waste icons in the day overview and existing import. Any optional next-event card is one selected event under R13-04, not a dedicated waste widget. | R12 baseline has waste-purpose import/day-plan support; requested removal is unimplemented. | No new evidence. | R12 baseline only. | No. |
| R13-06 Display identity/configuration | Open/copy addresses for existing display pairings without exposing URL secrets; pair a new device; revoke any device independently. Reuse one selected display setup for multiple individually revocable devices without silently duplicating configuration. Family layout has a separate integration flag. Per-display preview includes cards, order, people, sources, temperature, background, theme, language and actions. Server enforces projection ACL; protected images/caches cannot leak across displays or revocation. | No new evidence. R12 confirms existing ACL paths only. | No new evidence. | R12 ACL checks are baseline only. | No. |
| R13-07 Permissions | Read-only is default. Optional message creation uses the real stored display author identity and never impersonates a member; recipient scope remains restricted. Grocery, dinner, photo and HA grants are separate. Display writes require an explicit capability. Enforce all grants server-side. | No new evidence. | No new evidence. | No new evidence. | No. |
| R13-08 Messages and media | Message author/avatar is clear; handwritten body remains readable; emoji render; match reference `23_52`; keep Samvev identity and no family footer. Private background upload/reset works. Shared album has slow loop, pause/interval controls, mobile orientation behavior, resized uploads, quotas, GPS metadata removal, backup/restore, deletion and current-ACL checks. | No new evidence. | No new evidence; fictional images only. | No new evidence. | No. |
| R13-09 Grocery and dinner | Concurrent durable grocery add/check/undo/delete works for authorized household members. Dated dinner entries support emoji and prevent duplicates. Display can write only with explicit display grant. | No new evidence. | No new evidence. | No new evidence. | No. |
| R13-10 Home Assistant and T1–T3 | Only selected temperature/light/garage commands run through backend allowlists. Grants are person/display-specific; state freshness/errors are visible; garage requires confirmation. Do not auto-test physical commands or queue offline commands. Shelly communicates through HA. Additionally satisfy T1–T3 below. | R12 baseline verifies selected read-only temperatures; all new actions and T1–T3 unimplemented. | No R13 evidence. | R12 read-only baseline. Current public state has one existing HA connection; preserve it and do not ask for a generic reconnect. | Provider consent for any new live verification is separate; no secret is required for the isolated fixes. |
| R13-11 Public information pages | Anonymous `/om`, `/personvern`, `/vilkar`; content accurately describes data flows/privacy and verified operator/contact; discreet login/help, no family footer. Google Pages authoring remains a separate backlog task. | No new evidence. | No new evidence. | Test origin only; no information-page verification. | **Yes:** verified legal operator and privacy contact are unknown. Do not fabricate. |
| R13-12 Google and Microsoft setup | Google guide has five steps covering API/client/callback/Branding/Audience/connection; uses current official docs; states scope of testing vs publishing vs verification; includes exact Branding table and missing owner fields. Microsoft distinguishes installation-owner directory/app registration from calendar-account authorization; supports personal and work accounts; does not guess account-lock cause; cites current free eligibility; never creates an organization. | No new evidence. | No new evidence. | Current public state has one existing Google connection, not currently connected (not revoked); preserve it and do not claim live provider verification. | Owner registration/consent may be required for live validation, but guide/code work is not blocked. |
| R13-13 Traceability, QA and release | Keep this implemented/synthetic/public/owner-blocked matrix current. Use fictional people/data and local runner. Run meaningful full-target tests, backup/restore and review. Release gate runs last. Public test deployment is authorized. DCO-sign feature-only delivery. No PR, merge, main/force push, tag/release or Actions dispatch. Report files, tests, risks, migration/rollback, screenshots and data/secret hygiene. | Registration only; no new implementation. | No new evidence. | R12 evidence is historical. | No, except factual owner inputs called out in R13-11 and live provider consent. |

## First implementation package: temperature T1–T3

These three defects are the first package, not a scope replacement for the matrix
above. Source locations below are from the copied owner mailbox/reviewed source;
verify current code before edits.

| ID | Reproduction and required acceptance | Initial status | Likely file ownership and dependencies |
|---|---|---|---|
| R13-10-T1 | With synthetic HA, select registry A (`sensor.synthetic_outside`), then rename A and let registry B take A's former entity ID. Preview and worker polling must resolve and verify A's stable registry identity before reading and again before persisting, including concurrent rename/discovery. Never show B under A's name or sharing. If identity is missing/mismatched, keep last valid observation marked stale/unavailable and expose recovery. Legitimate rename preserves account/name/order/grants. For no-registry sources, document limits and require explicit revalidation; never merge or transfer grants. Test rename, takeover, missing/changed registry rows, preview, worker, race, and wrong returned entity ID. Preserve origin/DNS/time/response guards; do not fault-inject live owner HA. | Unimplemented. The mailbox identifies the existing gap: temperature calls pass stored entity ID and validate returned ID/type, not selected registry ID. | Backend owner: `services/api/src/calendar/service.ts`, `home-assistant-client.ts`, relevant registry contracts/tests. Depends on existing stable-ID model and safe write/revision boundary. |
| R13-10-T2 | Active authorized sensor → provider disable → same-origin/account valid OAuth. Resume scheduled polling automatically, revalidate identity/type as needed, retain stale state until a valid new reading. Never leave an active sensor silently unscheduled. Preserve pause/stop/disconnect/revocation. New origin/account cannot inherit old grants without explicit validation/approval. Test active recovery, paused/inactive, missing source, revoked owner, failed consent, old callback/in-flight poll and origin change; preserve calendar recovery/F1–F3. | Unimplemented. Mailbox notes disable clears `next_poll_at`, OAuth completion reschedules calendars only, and worker requires a due timestamp. | Backend owner: provider configuration, OAuth completion, worker scheduling and tests. Depends on T1 identity validation and generation/revision/lease guards. |
| R13-10-T3 | With 300 allowed calendar entries for member / 200 for display and one or more permitted sensors, temperatures remain available through a bounded separately ACL-filtered projection. Do not raise global item limits indiscriminately or fetch unbounded data. Preserve calendar/reminder behavior, privacy mode, display/person grants, disconnect and revocation. API/server tests cover both limits, multiple sensors, allowed/denied users and displays, SSE/update/withdrawal; assert denied values and metadata are absent. | Unimplemented. Mailbox identifies a combined 300/200 priority/time sort that can starve observations lacking `starts_at`. | Backend owner: Home API projection and calendar service; frontend only if settled API/SSE contract requires it. Depends on T1/T2 behavior and server ACL. |

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

Publisher Git HEAD is `df04e82`; root Git HEAD `390f6a6` is intentionally stale.
All 246 runtime source files independently match the publisher and deployed
`00ddc36f` baseline; there is no newer uncommitted runtime work. Root Git status
is historical dirt. Avoid treating the checkout metadata difference as a source
conflict or asking every agent to rediscover it. The two guest disk expansions
are complete; no disk job is authorized. Preserve root Git, existing LAN admin,
data, photos, vault, sensor/calendar choices and AI schedules.

## Evidence update — first backend checkpoint

T1–T3 have an implemented root-worktree candidate, additive migration 027,
7/7 new regressions and 16/16 relevant existing regressions on the isolated local
Compose runner; API typecheck passes. See `ROUND_13_STATUS.md` for exact log paths,
review findings and remaining integrated/public checks. Earlier initial-status
rows above describe registration, not the current checkpoint. No new public
version or screenshot evidence exists yet. HA control, Home, displays, media,
lists, public pages and provider-guide additions remain open.

### Home backend evidence checkpoint

R13 birthday/week/school backend is locally implemented and synthetically tested
(15 passing focused/regression tests; API typecheck pass). Four bounded review
findings were fixed and re-reviewed. UI and public verification remain open.
Evidence: `.local/m3/round13/home-focused-tests.log` and `home-api-check.log`.
No completion claim applies to the full birthday, school or chronology UX yet.
