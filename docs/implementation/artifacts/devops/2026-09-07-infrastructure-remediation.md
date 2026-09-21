# Infrastructure remediation evidence — 2026-09-07

This record addresses Gate D findings D1/D2/SEC-08 and D3/SEC-09. All Docker
commands were scoped to Compose project `samvev-m1`.

## Image and dependency updates

- Node runtime and browser image: `node:24.20.0-bookworm-slim`.
- Runtime, test and QA database images: `postgres:17.11-bookworm`.
- `@playwright/test`, `playwright`, and `playwright-core`: `1.63.0`.
- `@axe-core/playwright` remains pinned at `4.13.0`.

Version decisions use the official [Node 24.20.0 release](https://nodejs.org/en/blog/release/v24.20.0), the
[PostgreSQL 17.11 release notes](https://www.postgresql.org/docs/17/release-17-11.html), and the audit remediation
for `GHSA-7mvr-c777-76hp` recorded in `M1_REVIEW_FINDINGS.md`.

## Runtime database preservation

Before upgrading the PostgreSQL minor image, a scoped logical dump was written
outside Git at `.local/backups/samvev-m1-runtime-before-postgres-17.11.sql`.

- SHA-256: `dd21df1375f37999d91d87362c4b482b1b85cd8cc844a9f652c4ebe10a85ae7d`
- Size: `54975` bytes.
- Check: file is nonempty, checksum matches, and it contains the migration
  ledger identifier.

The existing `samvev-m1-postgres-data` volume was retained. After recreation,
the runtime database reported PostgreSQL `17.11 (Debian 17.11-1.pgdg12+2)`,
four synthetic `persons` rows and three `schema_migrations` rows. The app and
worker health checks were healthy.

## Executed checks

| Command or check | Result |
| --- | --- |
| `bash scripts/m1.sh lock && bash scripts/m1.sh install` | Passed; lockfile resolved Playwright 1.63.0. |
| `npm audit --include=dev --audit-level=high` in labeled `tools` container | Passed: `found 0 vulnerabilities`. |
| `bash scripts/m1.sh start` followed by scoped Compose health wait | Passed; runtime Node `v24.20.0`, npm `11.19.0`, PostgreSQL `17.11`. |
| `bash scripts/m1.sh test` | Passed; migrations plus current web/core/API unit and integration tests. |
| `npm run build && npm run check && npm run lint` in labeled `tools` container | Passed. |
| Forced `docker compose build --no-cache browser` | Passed; image rebuilt from Node 24.20.0. |
| Chromium launch in labeled browser container | Passed with Node `v24.20.0` and Playwright `1.63.0`. |
| `docker compose config --quiet`, `bash -n scripts/m1.sh`, `git diff --check` | Passed. |

The complete QA acceptance sequence was intentionally not rerun here: the
review record retains known frontend contrast, preference and visual-baseline
failures for the responsible writers. This remediation does not replace that
required full retest.

## QA cleanup guard

`qa-test` now discovers only volumes filtered first by
`com.docker.compose.project=samvev-m1`, requires the exact expected QA volume
name before inspection or removal, verifies the owned result immediately before
deletion, and exits on cleanup errors. No owned result is treated as the
explicit first-run case. Immediately after Compose creates a new QA stack, the
script asserts the same label and exact name before starting the QA database or
running a browser check. The existing QA volume was queried through that
project filter and reported the expected `samvev-m1` label.

No secrets or private household data were introduced. The backup and all Docker
resources remain local to the `samvev-m1` project.
