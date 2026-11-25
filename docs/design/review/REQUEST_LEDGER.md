# Samvev combined experience, defect and wish ledger

Updated: 2026-10-27. Round 14 is the current active request; its evidence and
open requirements are in `ROUND_14_REQUIREMENTS.md` and its resumable checkpoint
is `ROUND_14_STATUS.md`. The dated R13 ledger below is retained as historical
scope and evidence, not silently replaced. The R13 owner actions remain separate
follow-up items and are not blockers to this round.

## Round 14 — active request

The three owner issues are the source of scope: [#15 compact calendar and person
colors](https://github.com/pabben/samvev/issues/15), [#14 ICS link
onboarding](https://github.com/pabben/samvev/issues/14), and [#13 Anthropic
provider](https://github.com/pabben/samvev/issues/13). The work sequence is
design/reference review and #15, then #14, then #13; all three are required.
The initial acceptance/evidence snapshot is in `ROUND_14_REQUIREMENTS.md`.

R14 inherits the preservation boundary: preserve user data, vault, existing
connections, AI tasks/schedules, protected Git metadata and current runtime;
no AI or schedule mutations; use synthetic household data, local runners, final
review and restore before any authorized public publish, with feature-only DCO
delivery. No secrets or private household names may enter repository artifacts.
Any live Anthropic request requires a separate owner action; synthetic transport
is the test boundary until then. The existing R13 owner actions remain recorded
in `ROUND_13_OWNER_ACTIONS.md` and do not block this R14 work.

## Historical Round 13 — retained scope

All 13 numbered areas below were active in R13. `ROUND_13_REQUIREMENTS.md`
carries that round's acceptance matrix and evidence; `ROUND_13_STATUS.md` is its
resumable run record. T1–T3 were the first package within R13-10, not a scope
replacement. R13 owner-controlled follow-ups remain distinct from R14.

Statuses distinguish verified R12 behavior from newly requested behavior. No
new implementation or verification is claimed by this registration.

| ID | Active area | Combined request | R12 baseline / remaining work |
|---|---|---|---|
| R13-01 | Economical agent operations | Use explicit model choices; sequential writers; local runners; durable resumable status. Record actual models and do not guess the main model or model costs. | Existing request only; no full process evidence for this goal yet. The owner supplied a record for repo scout, requirements, architecture and UX reviews: `gpt-6-luna` at medium/high/high/high. |
| R13-02 | Preserve data and environment | Preserve current data, vault, AI tasks/schedules, root Git metadata, LAN admin and runtime. No new disk jobs. | R12 reports preservation and completed disk expansions. Root HEAD `390f6a6` is intentionally stale; canonical publisher is `df04e82`. All 246 runtime files match publisher/deployed `00ddc36f`; no newer uncommitted runtime work. Root Git status is historical, not new work. |
| R13-03 | Birthday/day overview | Birthday today/tomorrow, subtle balloons, reduced motion, household-local midnight, multiple birthdays and no guessed age. Preserve day overview. | R12 confirms household-local Today/Tomorrow calendar preview. An existing saved birthday matches the owner's reported month/day and the household birthday setting is enabled; no date/name is recorded here. Presentation and acceptance cases remain open. |
| R13-04 | People, week and school cards | Person-card calendar preview only today/tomorrow; person details retain future chronological activities. Keep cards quiet without repeated empty copy/CTA. Add current/next week and paging, plus optional exactly one selected next event. School results belong on actual actionable subject/person cards; expire at known school end time on the relevant day, otherwise on the 13th local date. Put future preparations on their own dates; prevent unchanged-source resurrection; retain history/detail; keep off family table; no AI calls for presentation/subject edits. Keep card heights honest with useful empty/error states. | R12 confirms preview/detail calendar date rules only. All other behavior remains open. Never interpret cutoff as school-year end; never restrict person details to two days. |
| R13-05 | Waste presentation | Remove the separate Next Waste surface; retain day waste icons and import. Any optional next event is a separately selected single event under R13-04. | R12 confirms waste-purpose import/day-plan behavior, not removal of the separate surface. |
| R13-06 | Display identity and configuration | Open/copy an existing display address, pair another device, revoke pairings without exposing URL secrets. Reuse one chosen display setup across multiple individually revocable devices; do not silently duplicate config per device. Family layout has an independent integration flag. Per-display preview covers cards/order/people/sources/temperature/background/theme/language/actions. Enforce server ACL and prevent image-cache leaks. | R12 verifies tested display ACL paths only. New management/configuration requirements remain open. |
| R13-07 | Permissions and message identity | Read-only is the permission default. If message creation is granted, store the real display author identity; never impersonate a member. Restrict recipients. Separate grocery/dinner/photo/HA capabilities. Display writes require explicit grants. | Open. Permission enforcement must be server-side. |
| R13-08 | Message, photo and shared album | Preserve readable message author/avatar; handwritten body is readable, emoji work, use visual reference `23_52`, retain Samvev identity and omit family footer. Support private background upload/reset. Shared album needs slow loop, pause/interval controls, mobile orientation, resized uploads, quotas, GPS metadata stripping, backup, deletion and ACLs. | Open. No real household photos/content in public fixtures. |
| R13-09 | Shared grocery and dinner lists | Durable concurrent grocery add/check/undo/delete for authorized household members. Dated dinner entries with emoji and duplicate prevention. Display writes explicit. | Open. |
| R13-10 | Home Assistant status and actions | Selected temperature/light/garage controls only through backend allowlists, with per-person/display grants, freshness/error states, garage confirmation. Never auto-test physical commands or queue offline commands. Shelly goes through Home Assistant. Also fix T1–T3: selected sensor identity on every preview/poll/write; recover authorized active polling after same-origin/account OAuth; prevent calendar-count limits starving allowed sensor projections. | R12 verifies read-only temperature selection/preview/polling/status. One existing public HA connection must be preserved; do not ask for a generic reconnect. Command behavior and T1–T3 remain open; T1–T3 are the first implementation package. |
| R13-11 | Public pages | Anonymous `/om`, `/personvern`, `/vilkar`; accurate privacy/data-flow statements and verified operator/contact facts; discreet login/help; no family footer. Keep Google Pages authoring as a separate backlog task. | Test origin `https://samvev.pabben.org/` is known. No verified legal operator/contact found; do not invent. The informational-page facts are owner-blocked. |
| R13-12 | Google and Microsoft onboarding | Google five-step setup: API/client/callback, Branding, Audience and connection; cite current docs; distinguish testing/publishing from verification; exact Branding table and missing owner fields. Microsoft: app registration owner separate from calendar accounts, personal/work support, no guessed lockout cause, current free eligibility docs, no organization creation. | One existing Google connection is currently disconnected; preserve it and do not claim live verification. Open and subject to current provider documentation and real owner inputs/consent. No synthetic test is live provider verification. |
| R13-13 | Traceability, QA and release | Maintain implemented/synthetic/public/owner-blocked status; fictional data and local runner; full target tests and backup/restore; release gate last. Public test deployment is authorized. DCO-sign feature-only changes. No PR/merge/main or force push/tag/release/Actions. Preserve privacy. | R12 gives historical baseline evidence only. New requirements need fresh evidence before claims. |

## Baseline and evidence boundaries

Round 12 reports delivered Today/Tomorrow calendar previews, chronological future
person details, HA calendar discovery/registry identity, waste-purpose import,
read-only selected temperature preview/polling, and fixes F1–F3 on source
`00ddc36f74fa41925fc0cc6e9b7e6b462e96a37a`. It reports 374/374 tests, five
workspace checks/builds, public ACL/SSE checks, migration 026, preserved data,
and completed guest disk expansions. These are historical verified baseline
claims. They do not mark any new R13 acceptance criterion complete.

No verified legal operator identity, privacy contact email or contact URL was
found in reviewed documentation. Public pages must use verified owner facts, not
inference from the repository name or test origin. Provider consent/source
activation remains distinct from synthetic QA.
