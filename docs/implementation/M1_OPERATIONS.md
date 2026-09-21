# M1 local operations

This guide applies only to the local Compose project `samvev-m1`. It does not
configure a reverse proxy, firewall, system service, host database, or any
other Docker project.

## Runtime contract

The Compose stack has three persistent services:

- `db`: PostgreSQL durable state, available only on the project network.
- `app`: Fastify API and built web assets, loopback-bound on port `4173`.
- `worker`: the restart-safe database-backed scheduler and expiry worker.

`dependencies` installs every workspace manifest in `package-lock.json` into the
`samvev-m1-workspace-node-modules` project volume. `migrate` must complete
before `app` or `worker` starts. The API must expose `GET /api/v1/health`; the
worker must refresh the file named by `SAMVEV_WORKER_HEALTH_FILE` at least every
30 seconds. Both contracts are enforced by Compose health checks.

The source checkout is mounted only at `/workspace`; `.git` is excluded from
the image context, remounted read-only inside tooling containers, and no
container command uses Git. Docker build state and Compose temporary metadata
are confined to ignored repository-local `.local/buildx` and `.local/tmp`
directories so these commands do not need to write host-global configuration.

## Commands

Use these commands from the repository root. They use `.env.example` until a
local `.env` exists, so a first local M1 start is one command:

```bash
bash scripts/m1.sh start
```

The app is available at `http://127.0.0.1:4173` after its health check passes.
Inspect only this project with:

```bash
bash scripts/m1.sh status
bash scripts/m1.sh logs
```

Stop runtime containers while retaining state:

```bash
bash scripts/m1.sh stop
```

Run migrations and tests in the isolated `samvev_test` PostgreSQL service, and
browser tests in the project browser image:

```bash
bash scripts/m1.sh test
bash scripts/m1.sh browser-test
```

Run the complete destructive QA acceptance sequence in its separately named
`samvev-m1-qa-postgres-data` volume:

```bash
bash scripts/m1.sh qa-test
```

Before that sequence removes an existing QA volume, it verifies the exact
`com.docker.compose.project=samvev-m1` label through a project-filtered query,
then confirms the exact expected volume name before inspecting or removing it.
A missing owned QA volume is the normal first-run case; after creation the
script asserts ownership before starting the QA database. Cleanup errors stop
the sequence instead of being ignored.

Refresh the project-local dependency volume only when `package-lock.json`
changes:

```bash
bash scripts/m1.sh install
```

When a dependency declaration changes, regenerate the lockfile in the labeled
tooling container, then refresh the dependency volume:

```bash
bash scripts/m1.sh lock
bash scripts/m1.sh install
```

## Synthetic-data reset and rollback

`reset-demo` is deliberately destructive and works only when the selected
environment file explicitly contains `SAMVEV_DEMO_MODE=true` and the full
confirmation argument is supplied:

```bash
bash scripts/m1.sh reset-demo --confirm-synthetic-demo
```

It removes only named `samvev-m1-*` Compose volumes and containers. It must not
be used after claiming an installation or entering non-synthetic data. There is
no automatic schema down migration: restore a verified PostgreSQL backup before
returning to an earlier application version. Initial M1 migrations are additive
and tracked by the API migration ledger.

## Local configuration

`.env.example` contains synthetic development values only. Copy it to `.env`
before changing the loopback port or database password. Do not commit `.env`.
The PostgreSQL port is intentionally not published to the host.

Browser dependencies are installed while building the Compose `browser` image;
no host Node, npm, browser, or global package installation is required.

## Troubleshooting

- First build can take several minutes. Use `bash scripts/m1.sh status` to
  confirm `app`, `db` and `worker` are healthy, then inspect the scoped logs.
- If loopback port 4173 is unavailable, set another local `SAMVEV_PORT` in the
  repository's ignored `.env` and restart with the normal start command.
- Pairing codes expire and are redeemed once. Repeated tests can reach the
  start-request rate limit; wait for its normal 15-minute window instead of
  resetting the runtime or changing the limiter.
- Browser tests deliberately use fictional owner/Robin fixtures. Runtime
  replay preserves existing people/history and creates test displays. See
  [the demo guide](M1_DEMO.md) before using these commands.
- After a direct development asset rebuild, restart the scoped app so its
  static asset routes reflect the new build:

  ```bash
  docker compose -p samvev-m1 -f compose.yaml restart app
  ```

- A migration checksum failure must be investigated; do not edit the migration
  ledger or an applied SQL file to suppress it. The QA helper resets only its
  separate guarded synthetic volume; retained data needs backup-based recovery.
- Visual comparison defaults to compare and never approves replacements.
  `qa-candidates` is the original reviewed source, `qa-approved-baselines` stores
  approved images/masks, and `qa-final` stores the latest complete capture.
  Earlier diagnostic failure JSON is timestamped and retained for provenance.

## Image maintenance and local rollback

The M1 images use Node `24.20.0-bookworm-slim` and PostgreSQL
`17.11-bookworm`. Before a PostgreSQL minor-image upgrade, take a scoped logical
backup into the ignored `.local/backups` directory:

```bash
mkdir -p .local/backups
docker compose -p samvev-m1 -f compose.yaml exec -T db \
  pg_dump --clean --if-exists --no-owner --no-privileges -U samvev samvev \
  > .local/backups/samvev-m1-runtime-before-postgres-upgrade.sql
sha256sum .local/backups/samvev-m1-runtime-before-postgres-upgrade.sql
```

PostgreSQL 17 minor upgrades reuse the existing `samvev-m1-postgres-data`
volume. If an upgrade must be rolled back, stop only `samvev-m1`, restore the
previous PostgreSQL 17 image, and use the verified logical backup if the data
directory cannot be reused. Do not use reset commands for this recovery.

The M1 pre-upgrade synthetic backup was checked for checksum, nonempty contents
and expected SQL markers. A restore was not exercised, so this is not a claim
of tested disaster recovery. No automatic schema down migration is supplied.

### Isolated restore verification

The supported recovery gate uses a fresh PostgreSQL container, a new temporary
volume and an internal restore-only network. It must never reuse the live volume,
live database URL or live network, and it must not start a worker. Use the same
PostgreSQL major version and matching immutable application runtime as the
selected backup.

Before restoring, verify mode, size and SHA-256 and require `pg_restore --list`
to parse the custom archive. Restore into the empty clone with
`pg_restore --exit-on-error --single-transaction --no-owner --no-privileges`.
Then require the supported migrator to accept every stored checksum, verify the
schema/constraints and sanitized data presence, and start only the isolated app
for health, anonymous authorization and synthetic login/read/logout checks.
Remove only the named clone containers, network and volume, retain the backup,
and compare live container identity and health before and after.

The 2026-09-20 execution of this procedure is recorded in
[M1_RESTORE_GATE.md](M1_RESTORE_GATE.md). It passed for the PostgreSQL 17 backup
from deployed candidate `f82951b`. Physical display validation remains
**DEFERRED BY OWNER — NOT VERIFIED — NON-BLOCKING for the current merge**. It is
separate follow-up work and is not represented as tested by this procedure.
