# M3 local QA report

Executed locally on 2026-09-24 against Compose project `samvev-m1`. All
identities, payloads, displays and database rows used in this report are
synthetic. No external Home Assistant, OpenAI, push provider or production
system was contacted.

## Result

The final local regression run is green.

| Area | Evidence |
| --- | --- |
| Workspace tests | `bash scripts/m1.sh test`: web 22/22, contracts 5/5, core 3/3, API 152/152, worker 0/0; 182 passing, no failed/skipped/todo. Log: `.local/m3/final-qa/npm-test.log`. |
| Types and build | `npm run check && npm run build` passed in the project tools container. |
| Lint command | `npm run lint` exited 0. It has no configured workspace lint scripts, so it is a dispatcher check only, not substantive lint coverage. Log: `.local/m3/final-qa/tools.log`. |
| External intelligence API | API integration coverage includes all six item kinds, strict payload validation, optimistic idempotent upsert, deletion, producer `contentLocale` NB/EN, connection/credential isolation, capability denials, expiry, individual revocation, cross-household administration denial, child personal filtering, member capability downgrade and display/member SSE invalidation. |
| Migrations | Fresh 001--018 then rerun: 18 ledger rows and nullable `integration_items.content_locale`. A simulated existing 017 database with a persisted synthetic external item upgraded to 018 without changing its title/status; its language remains explicitly `NULL`. Logs: `.local/m3/final-qa/migration-{fresh,rerun,upgrade}*-018.*`. |
| Legacy browser smoke | 16/16 passed against the separate synthetic legacy app/database, including real pairing, worker schedule/expiry, SSE, offline state, NB/EN, light/dark, reduced motion and Axe. Log: `.local/m3/final-legacy/smoke.log`. |
| Browser review regressions | 10/10 passed, including account/role controls, accessibility, offline/reconnect, privacy/revocation and cache expiry. Log: `.local/m3/final-legacy/review.log`. |
| UX states | 10/10 passed across 390×844, 1280×752 and 1920×1080, including focus, long Bokmål content, permission-concurrency handling and privacy. Log: `.local/m3/final-legacy/ux.log`. |
| E2E harness | `npm run test:e2e-harness`: 10/10 unit checks plus the browser-driven synthetic-intercepted setup/Test-now/delete flow passed. It used no live credential or external source. Log: `.local/m3/final-qa/e2e-harness.log`. |
| M3 dashboard | The real local API harness passed 10 check groups with 15 screenshots: mobile, iPad portrait/landscape, 1920×1080, Shelly 1280×752, NB/EN, light/dark/system, Axe, reduced motion, keyboard focus, dynamic 1/4/8 people, one-time credential display, SSE and offline item expiry. Result: `.local/m3/final-m3/results.json`; images: `.local/m3/final-m3/`. |

## QA changes

- Added an API regression scenario for scoped integration credentials and
  projections: write/read/delete capability boundaries, token expiry and
  individual revocation, household isolation, child filtering, and both SSE
  audiences.
- Updated legacy browser fixtures for the M3 Home/More navigation, resilient
  async display-language readiness, repeatable scheduled-message data, and
  the current role selector.
- Updated the shared runtime browser driver to open **More** before the
  secondary experimental Tasks/Oppdrag surface.
- The review test found that a user without `household.manage` could select
  an administrator role only to receive a safe server rejection. Frontend
  commit `175a20b` disables that unavailable option and guards the chooser;
  the updated regression asserts both denied and allowed cases.

## Visual baseline boundary

`tests/e2e/visual-regression.mjs` and its 2026-09-07 baseline were left
unchanged and were not used as M3 acceptance evidence. The product request
supersedes that historic visual direction. This QA run instead records the
reviewed M3 real-API screenshot matrix above; no baseline, threshold or
candidate was promoted or loosened.

## Limits and follow-up

- The Shelly viewport is browser evidence, not physical-device certification.
- The worker workspace currently has no unit test files (0/0); API lifecycle
  and browser worker scheduling coverage ran successfully.
- `npm run lint` has no workspace linter configured. It exits successfully
  but does not add lint diagnostics.
- No deployment, GitHub Actions run, PR, push, live-E2E execution or
  production connection occurred.
