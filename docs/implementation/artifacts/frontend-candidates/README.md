# Gate E frontend candidates and execution evidence

**Superseded control artifacts — correction recorded 2026-09-07.** QA's runtime
wiring control overwrote this directory's smoke/focused results and screenshots
at 02:49–02:50 UTC. It used a distinct synthetic Robin and is not the required
fixed-fixture acceptance. The files here no longer represent the original
02:02 frontend run described below. That historical execution and review
occurred, but its original images/results are not preserved in this directory.
Do not use these current files for baseline approval or final acceptance.

The isolated, fixed-fixture baseline source is `../qa-candidates`, manifest
02:46:05.751Z. Final frontend fixes and full UX evidence are in
`../frontend-final/README.md`. The control added synthetic profile
`Robin browser 1788749350905`, active test displays `Browser smoke 1788749284717`
and `Browser smoke 1788749350905`, and ordinary synthetic smoke messages.
No private data was involved. Final cleanup is tracked in M1_STATUS.md.

## Historical 02:02 execution description (files later overwritten)

These are review candidates, **not approved QA baselines**. No existing QA
baseline image, comparison threshold, Axe rule or skip setting was changed.
All names, accounts, bodies and screenshots contain synthetic fixtures only.

## Results

- `review-regressions.json`: **10 focused browser checks passed**. Covers
  delayed/rapid preference writes with observable completion, failure/retry,
  reload after save, system/OS appearance, keyboard selection, localized
  publication/expiry/timezone preview and invalid-input preservation, unchanged
  composer/board Axe, separate people/account controls, elevated login
  requirements, real other-user activity, degraded/restored SSE ordering,
  offline stream recreation, individual card expiry and the fixed 15-minute
  reload/cache deadline.
- `smoke-results.json`: **15 full replay checks passed**, including real
  pairing, permission grants, immediate live delivery/render ACK, limited-member
  schedule/edit/withdrawal, real worker publication/expiry, strict offline →
  online recovery, persisted preferences and zero uncaught browser errors.
- Frontend type check and production build passed; **8 unit tests passed**
  without skips. Three stream-health tests include stale request/heartbeat and
  local offline/cache-loss epoch regressions. Cache tests retain later cards
  while enforcing the original hard reload deadline.
- Axe 4.13.0 uses unchanged `wcag2a`, `wcag2aa`, `wcag21aa` tags. The focused run
  passed composer and board; smoke passed People, paired display, composer and
  mobile Norwegian dark member view.

The full smoke replay used the existing synthetic installation; first-run
claim and fresh-volume operations are not claimed as rerun in this Gate E slot.
QA owns the complete fresh-volume/restart/security/visual-comparison sequence.

## Commands

All commands run inside the exact `samvev-m1` project:

```bash
docker compose --project-directory /home/administrator/apper/samvev --env-file .env.example -p samvev-m1 -f compose.yaml --profile tools run --rm --no-deps tools sh -c 'npm run check --workspace @samvev/web && npm run test --workspace @samvev/web && npm run build --workspace @samvev/web'

docker compose --project-directory /home/administrator/apper/samvev --env-file .env.example -p samvev-m1 -f compose.yaml restart app

docker compose --project-directory /home/administrator/apper/samvev --env-file .env.example -p samvev-m1 -f compose.yaml --profile browser run --rm --no-deps -e BASE_URL=http://samvev-m1-app-1:4173 browser node apps/web/tests/review-regressions.mjs

docker compose --project-directory /home/administrator/apper/samvev --env-file .env.example -p samvev-m1 -f compose.yaml --profile browser run --rm --no-deps -e BASE_URL=http://samvev-m1-app-1:4173 -e SMOKE_ARTIFACT_DIR=docs/implementation/artifacts/frontend-candidates browser node apps/web/tests/smoke.mjs
```

The upgraded Chromium failed navigation to `http://app:4173/` with
`ERR_SSL_PROTOCOL_ERROR`, despite healthy ordinary HTTP/API requests. Using the
existing project container DNS name above worked. No browser security flag,
host networking or global configuration change was used.

## Fixes and captured state

- F1: serialized observable member preference save; both controls disabled while
  pending; localized success/error; failed changes retain prior preferences.
- F2: stronger muted token `#52665d`, footer opacity removed, and valid semantic
  roles for labeled avatar/activity/code groups. No contrast rules disabled.
- F3: independent card expiry and hard cache loss are distinct. Loss clears
  saved projection and Live state; listener epochs prevent old requests or
  healthy heartbeats from claiming recovery. Online transition recreates the
  stream and requires ready plus a fresh successful projection.
- F4/F5: accessible pressed states and keyboard behavior; locale-formatted
  publication, expiry and household timezone preview; invalid local times are
  handled safely with form values retained.
- F6: original author remains visible alongside scoped edited/withdrawn actor
  names and locale-formatted timestamps.
- F7: email/login controls are independently gated by account management.
  Profile-only users cannot receive elevated roles/grants. The UI consumes
  optional `has_active_login`. It was queued at capture time and was subsequently
  added with active/disabled/profile-only and capability-visibility API tests.
  A later UX recheck found the People list still needed an accurate disabled-
  account label; that correction is tracked in M1_REVIEW_FINDINGS.md.

Every `display-{mobile,shared,shelly-xl}-{en,nb}-{light,dark}.png` capture asserts
Kitchen identity, exactly two expected fixture bodies in priority order,
Europe/Oslo, theme/locale and Live connection before capture. Dimensions are
390×844, 1920×1080 and 1280×752. Composer, People, pairing, limited scheduled,
offline and mobile nb/dark member candidates accompany the 12-profile matrix.

`failure-*.png` are superseded diagnostics from the pre-fix reconnect failure,
not passing evidence. That strict assertion passed in the final smoke. Earlier
Axe failure on the avatar group's missing role was also fixed and rerun.

Current successful smoke display: **Kitchen · example**,
`2ffc0c37-80a6-45f7-a09c-f90fe6d7bfef`. The coordinator later revoked three superseded runtime Kitchen credentials.
Further browser replays may create additional synthetic devices; final scoped
cleanup is tracked in M1_STATUS.md. Fresh QA captures have one Kitchen target. No verifier, credential cookie or browser auth-state file
is included.

No schema migration, dependency change, Git operation, parent/sibling access
or host-global modification was performed in this frontend fix slot. Rollback
is the frontend source/token changes; retained installation data need not be
reset. Physical Shelly hardware/firmware certification remains unexecuted.
