# Round 13 implementation and release report

Updated: 2026-10-16
Status: **candidate deployed; overall R13 remains open for owner-controlled verification**

## Candidate and verification state

Deployed source: `7c61557b92333408c628911784aff267411479ba`. Review revision: the Git commit containing this report and the accepted manifest (separate from the deployed source).

The current source is `7c61557b92333408c628911784aff267411479ba`. Immutable full QA
at base `fb08236` passed 485/485 (web141, contracts5, core3, API336, worker0)
and five workspace checks, actual exit 0. Current source changes only three
capture-helper files: bounded visible-image waiting and private failure diagnostics,
and bounded hyphenated privacy-label validation with regression assertions. Two actual browser cases and eight helper
tests pass. The predeploy gate and public restore for 7c615 passed.

Canonical14 round `20261016061136-7c61557b-3a479144` passed: root viewed and
hash-verified all 14 images; `ux13_final` reviewed visuals, while root and
`release13` verified 305 inputs, 12 assets and 229 Git checks. The candidate is
now publicly deployed. An earlier preflight safely refused while a scheduled
monitor held a schema-026 lease; that condition was resolved before the later
successful cutover. No schedule or model changes were made.

The earlier 468-test snapshot and subsequent 334/336 failure are historical.
The final immutable 485-test run and all five checks passed on `fb08236`; current
`7c61557` adds only capture helpers, covered by two browser cases and eight
helper tests.

The 7c615 predeploy restore, gate and canonical14 passed. The exact source/deployment identity is in the [Round 13 capture manifest](latest/manifest.json), round `20261016061136-7c61557b-3a479144`; seven supplemental safe Home captures are documented in [round13-supplemental](round13-supplemental/). Public cutover
completed with exit 0 at `.local/m3/round13/ops/cutover-20261016T062416Z/`.
Fresh schema-026 backup restore, forward migration 037 and second-run no-op
passed; a fresh schema-037 postdeploy backup restore and no-op also passed.
Existing columns/values and runtime, environment, vault and database-volume
identity were preserved. Actual HTTPS smoke passed all seven checks at
`.local/m3/round13/public-browser/postdeploy-smoke.log`: the three anonymous
routes direct-reload; anonymous privacy returns 401; all 12 served asset hashes
match; retained test-account login identity matches; Home and Displays navigation
work; the separate **Your settings** dialog opens without mutation; logout
invalidates the session. The anonymous authorization checks were specifically
`/api/v1/me` and `/api/v1/display/projection` (both 401).
This bounded smoke does not validate every feature or public write action.

## Requirement status

| Area | Current evidence | Remaining acceptance |
|---|---|---|
| Agent operations and preservation | Economical `gpt-6-luna/high` implementation, bounded `gpt-6.1-sol/high` security/operations review, and `gpt-6-astra/xhigh` release gate; durable status; data/vault/schedules/root metadata preserved. | Coordinator model/cost are unknown; no estimate is made. Keep any further verification bounded and preserve the environment. |
| Home, people, waste and school | Birthday/day/week/school UI and backend integrated; 23 focused backend tests plus API/contracts; Home layouts reviewed. Requested birthday registration, opt-in and household-local date privately verified; no birth year read or inferred, and no data changed. Waste surface removed. Person-future, school-provenance and C2 metadata/font fixes completed. | Existing saved-school tasks still need safe activation using actual origin/subject through an authorized `household.manage` session. This owner action need not block feasible delivery; overall goal remains incomplete until resolved. No impersonation, copies, AI calls or approval/schedule changes. |
| Display and permissions | Pairing/setup, preview/configuration, independently revocable device grants, read-only defaults, real display authorship, revocation, board focus/actions and compact layouts exercised. Display-address screenshot accepted. | Deployed; public smoke opened the Displays page and separately opened Your settings without mutation. Detailed authorization and actions remain synthetic-tested. |
| Messages, photos and media | Synthetic browser authorization/playback reviewed; private backgrounds and shared album flows exercised. Photo PUT/DELETE late-auth fix: 25 focused passes. | Public cutover/restore passed; the bounded public smoke did not exercise media or message flows. |
| Grocery and dinners | Six-person synthetic browser flows cover durable add/check/uncheck, sync, dinner assignment/reload, deletion, failure states and mobile hit target. | Source is deployed and synthetic acceptance passed; public smoke did not exercise board mutations. |
| HA and temperatures | T1–T3 and selected HA controls implemented; serialization and synthetic-transport browser evidence; no physical command. | Base full QA and canonical capture passed; public smoke issued no HA commands. Preserve explicit grants and do not run physical tests. |
| Anonymous pages and providers | Anonymous routes, privacy/data-flow copy, discreet links, Google/Microsoft administrator guides and UI; contact initialized privately in runtime config. | All three public routes direct-reloaded; anonymous `/api/v1/me` and `/api/v1/display/projection` returned 401; 12 asset hashes matched. Final contact API/page/reload check passed. Live provider consent and verification remain owner-controlled. |
| Traceability and delivery | Candidate source `7c61557b92333408c628911784aff267411479ba` is publicly deployed; restore drills and canonical14 passed. | Cutover and seven-check HTTPS smoke passed. Overall goal remains open for authorized saved-school activation and external provider consent/live verification. Synthetic HA transport is the accepted boundary; optional physical verification is not a completion blocker. |


## Google OAuth Branding reference for this installation

| Google Branding field | Value or source |
|---|---|
| App name | Samvev |
| Application home page | `https://samvev.pabben.org/om` |
| Privacy policy | `https://samvev.pabben.org/personvern` |
| Terms of service | `https://samvev.pabben.org/vilkar` |
| Authorized domain | `pabben.org` |
| Support email | Select the approved public support account or group in Google's console; confirm it is selectable there. The installation contact address is the proposed public value, not a substitute for Google's separate picker. |
| Developer contact | Configured from the confirmed installation contact through private runtime settings; no literal private address is stored in Git. |
| OAuth callback | Copy the exact configured redirect URI from Samvev's Google setup UI; do not infer it from a browser or LAN host. |

Runtime pointer: **Integrations → Calendar setup → Public operator contact**
on the installation-specific `/?tab=integrations` route. This installation-scoped
record feeds the public `/om`, `/personvern`, and `/vilkar` DTO and Google
Branding display. The confirmed contact is initialized in the public runtime
through private CLI configuration. The final contact UI check matched configured
data to the public pages and reloads. Do not put literal contact values in
repository files.

## Remaining gates and owner actions

The precise Norwegian UI sequence and provider/owner boundary are recorded in
the [Round 13 owner checklist](ROUND_13_OWNER_ACTIONS.md).

1. Complete external Google/Microsoft consent and live provider verification
   when the relevant owners are available.
2. Activate existing saved-school tasks through a real authorized
   `household.manage` session using actual task origin and subject. This may
   follow feasible delivery; it remains required for overall goal completion.
   Preserve task history, approval and schedules; no impersonation, copying or
   AI calls.
3. The synthetic HA transport is the accepted test boundary. Physical HA
   verification is optional and was not performed; no manual model calls or
   schedule changes were made.

Public routes are `https://samvev.pabben.org/om`,
`https://samvev.pabben.org/personvern`, and
`https://samvev.pabben.org/vilkar`. Authenticated entry points are
`https://samvev.pabben.org/?tab=displays`,
`https://samvev.pabben.org/?tab=integrations&setup=google`,
`https://samvev.pabben.org/?tab=integrations&setup=microsoft`, and
`https://samvev.pabben.org/?tab=integrations&setup=spond`. Provider UI is
deployed; no live provider OAuth/connection is claimed.

For displays, use **Open** or **Copy address** from the existing display row.
Use the separate setup flow only when pairing a new device; pair it into the
chosen shared display setup, then adjust cards/order/people/sources/temperature/
background/theme/language/actions and explicit grants there. Read access remains
default-denied and each paired device can be revoked independently.

Migrations 027–037 are additive/forward-compatible in the deployed chain.
Recovery uses the recorded backups and forward/no-op migrations; never restore an
older image/database over newer writes.

No private household names, event titles, contact values, credentials or live
provider data are included in this report.
