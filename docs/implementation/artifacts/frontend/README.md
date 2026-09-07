# Frontend Gate C evidence

All fixture people, accounts, household names and message bodies are synthetic.
No real household data or authentication storage files are included.

## Executed checks

- `docker compose --project-directory /home/administrator/apper/samvev --env-file .env.example -p samvev-m1 -f compose.yaml --profile tools run --rm --no-deps tools sh -c 'npm run check --workspace @samvev/web && npm run test --workspace @samvev/web && npm run build --workspace @samvev/web'`
  - TypeScript passed; four timezone/cache tests passed; production build passed.
  - Tests reject Oslo DST gaps/folds, impossible dates, cache rollback and TTL extension, and verify fractional-offset zones and individual card expiry.
- `docker compose --project-directory /home/administrator/apper/samvev --env-file .env.example -p samvev-m1 -f compose.yaml --profile tools run --rm --no-deps tools npm audit --omit=dev --audit-level=moderate`
  - Zero production dependency vulnerabilities.
- Browser image built successfully from the repository Dockerfile `browser` target, containing Chromium under `/opt/playwright`; runtime is nonroot.
- `docker compose --project-directory /home/administrator/apper/samvev --env-file .env.example -p samvev-m1 -f compose.yaml --profile browser run --rm --no-deps browser node apps/web/tests/smoke.mjs`
  - Initial complete pass is preserved in `initial-smoke-results.json`.
  - Exercised real first-run ownership, refresh/resume, four people, optional limited login, permission grants, browser-bound pairing, immediate live publication, device render ACK, mobile limited-member schedule/edit/withdraw, automatic accelerated publication/expiry, 12 visual profiles, offline/reconnect and persisted nb/dark preferences.
  - No uncaught browser errors in the complete initial pass.
  - A later replay on the already-populated installation stopped at a strict navigation locator because the visible message count changed the button's accessible name. Stable localized navigation labels were added and final type/build checks passed. Complete post-fix browser rerun is assigned to QA; do not treat that interrupted replay as a passing run.
  - An early attempt ran before app restart readiness and got connection refused; the successful run followed app readiness. The smoke now explicitly waits for health.

Final QA owns comprehensive E2E, accessibility, restart, clean-install, security and image-comparison baselines. These screenshots are initial executed evidence, not a claim that those later gates passed.

## Screenshot index

- `display-{mobile,shared,shelly-xl}-{en,nb}-{light,dark}.png`: all 12 real paired-display combinations, at 390×844, 1920×1080 and 1280×752.
- `welcome-en-light.png`, `onboarding-owner-en-light.png`, `onboarding-people-en-light.png`.
- `pairing-code-en-light.png`: short-lived synthetic pairing code; no verifier/cookie.
- `composer-preview-en-light.png`, `limited-scheduled-mobile-en-light.png`.
- `display-offline-shelly-en-light.png`, `member-mobile-nb-dark.png`.
- Any `failure-*.png` are superseded diagnostic captures and are **not passing evidence**.

The initial display snapshots honestly show a UTC fallback note: the original backend projection omitted household timezone. Frontend already consumes `display.timezone` when present; the coordinator queued the backend addition and final QA screenshot refresh. Physical Shelly hardware/firmware remains untested.

## Runtime fixtures and routes

- `/`: member sign-in, resumable setup, Messages / People / Displays.
- `/display`: independently paired restricted screen; member cookie never substitutes.
- `/workbench`: synthetic localized component examples; no mutations or integrations.
- Runtime household: **Example household**. Owner: `owner@pilot.invalid`; limited member: `limited@pilot.invalid`. Synthetic test password: `Synthetic-pilot-pass-42`. Morgan and Sky are profile-only fixtures.
- Synthetic Kitchen displays are paired by the smoke. Repeating it may add another synthetic display/messages; it never resets the installation. Browser credentials are not written to repository files.

## Implementation notes and boundaries

- React 19.2.8, Vite 8.2.2; semantic warm-neutral/teal light/dark CSS tokens; no external fonts or runtime services.
- en/nb catalogs are statically checked against the same key set. Roles/capabilities drive visible controls; all authorization remains server-side.
- Household-zone conversion rejects nonexistent and ambiguous DST times; no clock-control production API.
- Display projection cache has monotonic in-page expiry, persistent last-update timestamp, conservative reload age, individual expiry and maximum 15-minute TTL. Explicit 401/403 or SSE revocation clears data immediately; no render ACK is sent offline or for content outside the viewport.
- Pairing verifier remains in memory until one-use redemption. Credential cookies are HttpOnly. The SHA-256 dependency supports local HTTP where Web Crypto `subtle` is unavailable; randomness uses `crypto.getRandomValues`.
- App must restart after a rebuilt frontend to register newly hashed static assets (`fastify-static` currently uses `wildcard:false`). The app was restarted for browser execution.
- No frontend schema migrations. Reverting frontend files and the lockfile restores the prior UI build; do not reset retained runtime data to roll back code.
- No commits were attempted: `.git` read-only permission blocker is owned by the coordinator. No parent/sibling project or host-global configuration was accessed or modified.
