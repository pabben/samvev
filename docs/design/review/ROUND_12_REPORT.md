# Round 12 — HA calendars, daily overview and temperature

Mailbox: 1acfd46be4a23bc3449fbad359fb82b3ffa9d04f. Source:
00ddc36f74fa41925fc0cc6e9b7e6b462e96a37a.
Immutable image: sha256:baa1c70f781ae887a791e52c120a674384f1b9737a6093aee2d1785aa0806a02.
Latest round: 20261015115219-00ddc36f-d69a86e7.
Deployed source: 00ddc36f74fa41925fc0cc6e9b7e6b462e96a37a.
Public test: https://samvev.pabben.org/. Cutover completed on 15 October 2026.
Actual HTTPS login/logout, navigation, ACL and SSE checks passed on this source.
The review commit is the Git commit containing this finalized report and manifest;
it follows the source checkpoint and does not change runtime inputs.

## Implemented

- Home and person-card calendar previews use household-local Today/Tomorrow.
  Person details retain chronological later dates, source windows, timed/all-day
  intervals, shared content and existing AI tasks. Tests cover Europe/Oslo,
  exclusive all-day end dates, DST, midnight and October 15/23/24.
- Existing HA connections discover Spond and general calendars; explicit
  household/multiple-person subjects remain separate from reader/display ACLs.
  Stable registry identities survive entity renames. UID-less sources use
  complete-window local snapshot identities, preserving legitimate duplicates
  and retained data on failed/incomplete fetches.
- Explicit waste purpose provides household day-plan entries and Next collection,
  with multiple types and a forthcoming collection drawer. Waste stays off
  person cards. No sources were guessed or automatically activated.
- Selected HA temperatures have names/order, explicit sharing, targeted preview,
  normal polling/backoff, independent sensor errors, native units and separate
  HA-report/fetch timestamps. Missing values are not rendered as zero.
- F1: repaired same-client registration permits normal sync without falsely
  declaring success or requiring unnecessary consent.
- F2: Microsoft client replacement has an explicit new-account-binding path;
  old account/source/reader bindings are not silently transferred.
- F3: selected Spond entity health is checked before accepting a cached HTTP-200
  calendar snapshot. Unknown/unavailable sources retain stale content.

Changes are enumerated in [source-files.json](round-12/checks/source-files.json).
Contracts and recovery choices are documented in
[HOME_ASSISTANT](../../HOME_ASSISTANT.md) and ADR 0024.

## Tests and visual evidence

Complete final serial application suite: **374/374**, no skips/failures.
All five workspace checks/builds pass. The immutable build matches all 246
source inputs and ten served assets. Review helper tests: 16/16; privacy browser
test: 1/1. See [tests](round-12/checks/tests.json) and
[canonical build](round-12/checks/canonical-build.json).

The earlier failed full-suite and private browser-fixture attempts are retained
privately. The migration-list and revoked-preview compatibility defects were
fixed; no test was disabled or weakened. Final visual inspection also found and fixed a contradictory source-freshness label during invalid-client/retry-pending states. The final source passed the full suite again. Retained private fixture state and browser request completion were corrected before final recapture; product assertions remained intact. Focused reproduction of the database
cascade passed, so that failure is not claimed to have a proven root cause.

[Latest manifest](latest/manifest.json) contains 14 actual, masked LAN captures.
That retained household has five people and real HA data; it was not reseeded.
The separate isolated fixture has six fictional people (two adults/four children).
Its [19 source-bound captures](round-12/final-ui/manifest.json) pass actual
browser, axe and visual/privacy checks, including compact scrolling and the
source/reader distinction. Four [F1/F2 recovery captures](round-12/final-ui/recovery-manifest.json) also pass. Actual failing-sync response, stale source status before and after registration repair, and current status only after successful retry are asserted. All 37 current-source screenshots passed individual UX/privacy review. Predeploy and postdeploy operational/content release gates passed; evidence is recorded below.

## Data, migration and recovery

Only additive migration 026 was added. Migration 001–025 checksums and all 229
protected main-.git file hashes remain unchanged. QA25→26 and public24→25→26
isolated restore gates passed exact migration ledgers, replay/no-op, all
preexisting public-column values, constraints and amcheck. Public clone
authenticated reads and all ten assets also passed. Clones have no worker,
vault or exposed ports.

The ordinary QA runtime was upgraded through the existing runtime/build/capture
scripts with a fresh backup, preserving its database and existing HA selection.
LAN admin/admin was verified through actual browser login/logout.

Public recovery uses preserved backups/config/images and forward recovery after
026. Old R10 code is not declared compatible with new HA/temperature rows.
Never automatically restore an older database over subsequent user writes.
The exact fresh quiescent schema-24 backup was restored and migrated in isolation;
a fresh postdeploy schema-26 backup was separately restored with no-op replay.
Both passed preserved-column/constraint checks, amcheck, authenticated reads and
all ten candidate assets. The public database volume/container were not replaced.
Vault, environment, active Compose settings, existing photos, task settings,
subjects and sharing were preserved. See [cutover](round-12/checks/public-cutover.json),
[quiescent restore](round-12/checks/quiescent24-restore.json) and
[postdeploy restore](round-12/checks/postdeploy26-restore.json).

## Both guest filesystems

| Host | Logical volume before → after | Filesystem before → after | Available after expansion |
|---|---:|---:|---:|
| codex-dev | 106,296,246,272 → 213,670,428,672 B | 104,028,168,192 → 209,718,075,392 B | 103,730,622,464 B |
| claude | 83,747,667,968 → 105,222,504,448 B | 82,312,138,752 → 103,441,707,008 B | 20,663,500,800 B |

Both identities/start sectors/mounts and app/worker/database health were
independently verified. codex-dev's reviewed helper was executed by the owner
because this agent session cannot acquire local sudo privileges. No disk action
remains for the owner. See [capacity](round-12/checks/capacity.json).

## Real external verification versus synthetic evidence

On preceding source `a665cb7f52118f9ca221ee53c5c7bdd1f15a4078`, the preserved
LAN HA connection completed a real candidate worker sync of its
existing Spond source at 2026-10-15T11:01:16Z, with six retained occurrences and
no connection error. An authenticated calendar-list refresh then discovered
three sources, adding two inactive sources while deep-comparing and preserving
all existing person/reader/display/purpose choices. Earlier bounded private contract reads verified the actual
HA version, three discovered calendars (including UID-less data), and one
selected temperature-state contract. No private names, identifiers or values
are included here.

New waste/general-calendar/sensor activation is not live-verified: the owner
must select sources, purposes and rights. Public HA consent is separate from
LAN and has not been copied across installations. Google/Microsoft end-user
authorization and external calendar sync are not live-verified. Synthetic
provider tests do not imply working external consent.

## Owner GUI actions after public publication

1. [Spond / HA](https://samvev.pabben.org/?tab=integrations&setup=spond):
   the installation owner completes provider setup for the already-used HA
   instance and authorizes the public Samvev connection. LAN remains intact.
   On the connection, refresh the calendar list, explicitly choose calendars,
   household/people, readers/screens, preview and activate. Choose waste purpose
   for the intended waste calendar. Select/preview/share desired temperatures.
2. [Google](https://samvev.pabben.org/?tab=integrations&setup=google) and
   [Microsoft](https://samvev.pabben.org/?tab=integrations&setup=microsoft):
   finish installation-owner app registration where absent, then each account's
   provider sign-in/consent, source selection, preview and activation.
3. Previous personal ChatGPT consent/import and local-AI setup remain separate
   owner-dependent items; this round did not trigger AI calls or modify approved
   tasks/schedules.

No private data or secrets are introduced in tracked evidence. No PR, merge,
main/force push, tag/release or Actions dispatch is part of this round.

## Public verification

The [actual HTTPS run](round-12/checks/public-https.json) passed on the deployed
source: UI login/logout, secure cookies, existing protected synthetic photos,
Home/Integrations/AI-task navigation, Today/Tomorrow/person details, provider
entry points, installation-admin boundary, CSRF/cross-household isolation and
SSE ready/heartbeat. All ten public assets match the immutable candidate.
Public waste/temperature empty-state boundaries were checked without fabricating
source choices. No external account consent, AI call or source activation was
used for QA. Preferences were restored and no person/photo data changed.

The first check encountered a transient HTTP failure immediately after cutover.
A subsequent full run exposed a test-navigation issue: the provider setup dialog
remained open before the logout step. The test returns to Home before actual
UI logout; the final complete run passed with no external requests or page errors.
These attempts did not require a product-source change.

Public app and worker use the exact candidate image and are healthy; database
is healthy on schema 26. Recovery is forward-only unless a separately reviewed
restore is necessary; preserved older images are not declared compatible with
new user settings. No live database restore was performed.
