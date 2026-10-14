# Round 8 — authorized public test publication

Public URL: <https://samvev.pabben.org/>.
Deployed source: `15d047192abd63f4be18a90108fe969096da78d0`.
Immutable image: `sha256:91ecaa372bd43a8482e8c04c6d55f6f306219aafc8570f329cfbbd2bff9ba559`.
Publication: 2026-10-13 UTC. No application/source change was made during deployment.
The prior SSH authentication block is resolved; this report supersedes the earlier
public BLOCKED status, while retaining the original local review source/round.

## Verified target and immutable publication

The existing Samvev installation on claude was identified through exact
`com.docker.compose.project=samvev-m1` container labels, working directory and
active Compose files before changes. Its app/worker used immutable source
`f82951b67cf1fcc6f0c6f1be673ae40ee3562cf6`; PostgreSQL 17.11 used the existing
`samvev-m1-postgres-data` volume. Remote checkout HEAD was different and was not
used as deployment provenance or rewritten.

The candidate came from a Git archive of the frozen source through the publishing
checkout. Archive SHA-256:
`c8819f1dce596e435ca02e15e408faf3a7813a2e9d94e13fdbec7e16782ec57d`.
A separate ignored staging area and immutable image were built with clean locked
`npm ci --ignore-scripts` and the workspace build. Main independently verified all
199 source inputs and all 10 built web files against the reviewed source/build;
actual HTTPS served files match the same 10 hashes. No source or dependency bind
mount is present, so later LAN builds cannot overwrite public assets.

Original `.env`, database container/volume, claimed/non-demo state, normal public
passwords and the original read-only vault-key mount are preserved. Public
canonical origin remains HTTPS; demo mode and live-E2E routes remain disabled.
The actual immediate proxy connection was observed and matched the existing exact
`/32` trust rule. Pangolin/Newt and global proxy/host configuration were unchanged.
Actual private addresses and operational configuration remain ignored locally.

## Fresh backup and restore/migration gate

Before live changes, a fresh mode 0600 PostgreSQL custom archive was made:
`samvev-round8-pre-15d0471-20261013T230001Z.dump`, 206795 bytes,
SHA-256 `b45de104d164647a08b40341cba3e9e2889f562adf4ec923bba85af2ead37c7a`.
`pg_restore --list` parsed234 TOC lines. The archive remains private.

A new internal-only network, empty volume/database and matching old immutable app
were used without published ports or worker. Single-transaction restoration
passed. The old supported migrator accepted the exact16 stored checksums without
applying a migration. Invalid indexes 0, unvalidated constraints 0, foreign keys 60
and amcheck index verification passed. The retained synthetic account logged in normally,
resolved to its exact restricted membership, read authorized data and logged out;
the former session returned401. No owner household content was read/captured.

Audit limitation: the retained initial restore metadata does not establish the
exact `--no-owner --no-privileges` invocation. Its successful restoration/integrity
and login checks remain useful evidence, but it is not represented as a fully
audited prescribed-command drill. A separate fresh post-deployment current 20
restore has now passed with the prescribed recorded flags. It verifies present
recoverability and is not relabeled as a pre-cutover operation.

A separate candidate clone restored the backup and applied canonical 017–020.
All 20 checksums matched; the first16 were unchanged. Invalid indexes 0, foreign
keys 83 and amcheck index verification passed. The sole intentionally NOT VALID constraint is
`ai_rate_snapshots_nonnegative_rates`, introduced by020; it was not weakened or
misrepresented as a validated historical scan. Candidate health, ordinary login,
logout and exact synthetic registration/marker/role/capability binding passed.
No clone worker or provider operation was started.

At cutover, the old worker/app were stopped, and another mode 0600 paused backup
was created and parsed before live migration:
`samvev-round8-paused-precutover-15d0471-20261013T231752Z.dump`,
SHA-256 `adb080c229dad4ffca0f44431616bf1fbabd37cf3099e78baa325858cdcc9ed0`.
Only canonical 017–020 were applied to the live ledger. The candidate app was
verified before starting exactly one candidate worker. No new migration, reset,
reseed, password change or PostgreSQL image/volume replacement occurred.

## Completed current-version recovery audit

[Recorded recovery gate](round-8/public/recovery.json) passed at
2026-10-13T23:44:33Z against the deployed immutable 15d candidate and a new fresh
custom archive: 258237 bytes, mode 0600,
SHA-256 `fbe2333fca5261ae40aeea44ed6e4f913a564488c94a6651e11bd670efc68125`.
The exact private transcript records:

```text
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges
```

The empty isolated PostgreSQL 17.11 clone used a new internal network/volume, no
published host ports, a read-only candidate app and no worker or live vault key.
Archive parsing before/after and identical checksum passed. The migrator was a
true NOOP at 20 with every canonical checksum matching. Invalid indexes 0,83 foreign
keys, the sole expected NOT VALID constraint, five valid rate snapshots/no invalid
or NaN rates and amcheck B-tree index verification (`bt_index_check`) passed. Normal synthetic login, five authorized reads,
exact marker/capability binding, logout and subsequent401 passed.

Live container/image/config/volume fingerprints were identical before/after.
Exact clone containers/network/volume were removed; backup/transcript retained
privately. Two preliminary clone-only harness attempts failed on a read-only copy
method and outdated auth/capability handling; they were cleaned and excluded. The
completed fresh drill alone is the PASS record. This closes current recoverability
without inventing historical pre-cutover flags or reversing the live migration.

## Actual public HTTPS verification

[Public manifest](round-8/public/manifest.json),
[56 completed checks](round-8/public/checks.json),
[SSE measurements](round-8/public/sse.json) and
[image index](round-8/public/README.md) describe actual HTTPS evidence.

- Health200; claimed installation; demo and demo-account availability false.
- All 10 served build hashes match source 15d. CSP, nosniff, no-referrer,
  SAMEORIGIN and short public-only HSTS verified on index, API and404 responses.
- Actual browser login with the existing private synthetic test account; only
  its single restricted membership/person was accessed. Secure/Strict cookies,
  HttpOnly session, Origin/CSRF rejection, actual UI logout and subsequent401 pass.
  Public `admin/admin` is rejected and no demo credentials are displayed.
- Home, Messages, People, More, Displays, Integrations, Monitors and AI were opened
  at 1920×1080 and390×844 in light/dark:32 actual page/theme/viewport journeys,
  Axe A/AA and no horizontal main overflow. Message lanes, composer cancellation,
  person details, account preferences/focus and AI setup were exercised within
  existing permissions. Editing/pairing grants were not added for screenshots.
- Member SSE over the actual proxy:200, ready~93ms, heartbeat~15.1s,
  `X-Accel-Buffering:no` and source-tested CSP; no buffering observed.
  Anonymous member/display projection/events remain401.
- Existing synthetic people are hash-identical, and its account preferences were
  restored. Only this synthetic one-person household was captured; the public
  data is separate from isolated six-person primary and preserved five-person LAN.

Final run:56 checks, zero failures, page errors, blocked requests or browser
provider requests. Two earlier private helper attempts stopped on incorrect
ARIA-tab and hidden-desktop-button selectors; these were corrected without app
changes, and the full third retest passed. Failed logs are retained privately and
not represented as a successful complete run.

All 58 original public screenshots were personally opened and hash/dimension
verified by UX;50 are published unchanged. Eight originals (AI setup/preferences)
contain existing operator configuration/account identity and remain private.
No altered/mock screenshot, token, active code, credential or real household is
published. Temporary copied test credentials were removed; server originals stay.

## Existing scheduled-provider activity and final runtime

The browser journey invoked no model/provider/manual-monitor action. Separately,
two existing installation-wide approved daily monitor jobs became due during the
QA window. The old backup proves their due times were already Oct13 23:24:19 and
23:27:09 UTC, with prior checks the previous day and unchanged1440-minute cadence.
This was normal clock progression, not migration recomputation or browser activity.

Those two jobs made **three local OpenAI-compatible dispatch attempts**, all
failed (`AI_UPSTREAM_ERROR` / `AI_RESPONSE_INVALID`); no successful result/message
was created. Historical223 usage records are retained, and the final total is226,
with three confirmed new dispatch attempts. New dispatch metadata was introduced
by019; absent historical metadata is not proof about historic provider calls.
No paid fallback, force run, model discovery, OAuth or live ChatGPT test occurred.
Local-provider connectivity/output quality remains unverified and currently fails.

The public worker was briefly paused to diagnose this discrepancy, then resumed
once its retained schedules were proven. App, worker and database are healthy,
with exactly one worker; both jobs remain active with next runs on Oct14, no
queued/running executions. Configurations, approvals and source scheduler inputs
were preserved. Stable core identity/content/settings hashes match; normal
scheduler timestamps/audit history and the three retained attempts are explicitly
excluded from an impossible whole-database equality claim.

Main independently rechecked live ledger 20, invalid indexes 0, the exact expected
unvalidated constraint, usage226/dispatch3, empty active queue and all three
healthy runtime services. Four isolated clone containers, two internal networks
and two clone volumes were removed by exact owned labels/names. Original/candidate
images, overlays, private logs and verified backups are retained.

LAN remains <http://192.168.0.220:4173>: literal admin/admin UI login/logout,
health and served source hashes pass. Its nine QA tables, five people/18 messages,
preferences and229 protected main-Git files remain unchanged. No local source
or design change was needed and the14-image latest set still shows the same source.

## Rollback and review

The previous immutable image/overlay and verified backups are retained. Old app
health/login/member reads against the migrated clone passed; this is explicitly
**not** a general old-version write-compatibility guarantee. A rollback must stop
and drain the candidate, preserve any newer writes in a fresh private backup, and
verify the specific compatibility/restore path before using old code/schema.
Never blindly restore the pre-cutover snapshot over newer records. No rollback
was performed and migration history was not rewritten.

UX/public privacy, security and QA accepted the completed HTTPS evidence.
Existing minor visual polish/reference differences and physical-device validation
remain as documented in the local report. This test publication does not claim
live ChatGPT/provider eligibility, billing, owner design approval or a production
release. No PR, merge, main/force push, tag, release or Actions dispatch occurred.

Final independent release gate: **PASS for authorized public test publication**.
It verified the actual public container199 inputs/10 assets, all20 live canonical
checksums, public/LAN health and served files, three retained backups,158 actual
images plus two declared derived comparisons,224 prior files, and LAN9 tables/229
protected Git files. Existing provider failures and historical restore-invocation
limits remain disclosed; this is not physical-device/provider/design approval.
