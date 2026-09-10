# M1 local operations

This guide applies only to the local Compose project `samvev-m1`. It documents
the application boundary for a reverse proxy, but does not configure Pangolin,
a firewall, a system service, a host database, or any other Docker project.

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

## Move a local installation from synthetic to live data

The local bootstrap command stages a separate live household. It does not merge
or delete the synthetic household and it does not disable its accounts during
the prepare phase. Put personal input only in the ignored `.local/` directory,
set file mode 0600, and use a unique operation key:

```bash
chmod 600 .local/household-prepare.json
docker compose --profile tools run --rm migrate npm run bootstrap:local --workspace @samvev/api -- \
  .local/household-prepare.json .local/household-invitations.json
```

The prepare JSON has `phase: "prepare"`, `operationKey`,
`sourceHouseholdId`, household name/timezone/locale, the birthday setting,
and a people array. Each person has a display name, role preset, optional
`birthDate`, optional age group and optional email. Exactly one person must
be the installation owner and have an email. Accounts are invitation-only;
no bootstrap password is accepted or stored.

Keep the mode-0600 output: it is the only copy of the clear invitation tokens.
Opening an `/invitation#token=...` link sends the token in the URL fragment,
which is not included in HTTP request URLs. Acceptance sets a password and
starts a normal Samvev session. Prepare is idempotent, but a repeated call does
not reveal the already-hashed tokens again.
The CLI refuses group/world-readable input and refuses to overwrite an existing
output file.
If an invitation output is lost, leaked or expired before activation, use a
new mode-0600 input with `phase: "rotate"`, the same operation key and
`confirmRotateInvitations: true`, and choose a new output filename. This
revokes every still-pending bootstrap invitation before issuing replacements.

Only after the new installation owner has accepted the invitation and created
a newer authenticated session, create a second private file with
`phase: "finalize"`, the same `operationKey`, and
`confirmDisableSourceAccounts: true`:

```bash
chmod 600 .local/household-finalize.json
docker compose --profile tools run --rm migrate npm run bootstrap:local --workspace @samvev/api -- \
  .local/household-finalize.json .local/household-finalized.json
```

Finalize disables every account attached to the source synthetic household and
revokes its sessions. It retains people, messages, audit history and the source
household for controlled recovery. Finalize refuses to proceed if a source
account is shared with another household.

## Local configuration

`.env.example` contains synthetic development values only. Copy it to `.env`
before changing the loopback port or database password. Do not commit `.env`.
The PostgreSQL port is intentionally not published to the host.

Browser dependencies are installed while building the Compose `browser` image;
no host Node, npm, browser, or global package installation is required.

## Pangolin / reverse proxy deployment

Claim the installation through the private loopback URL before exposing it.
Do not publish a demo-seeded database: the API refuses to start with a public
HTTPS origin until the installation is claimed, `demo_mode` is false, and
`SAMVEV_DEMO_MODE=false`. Use these deployment values in the ignored `.env`:

```dotenv
SAMVEV_BIND_ADDRESS=0.0.0.0
SAMVEV_PORT=4173
SAMVEV_DEMO_MODE=false
SAMVEV_PUBLIC_ORIGIN=https://samvev.pabben.org
SAMVEV_TRUST_PROXY=192.168.0.188/32
```

The bind makes port 4173 reachable on every IPv4 interface of `claude`,
including its LAN interface. Do not add a router/NAT port-forward for 4173.
If only Newt should reach it, enforce a host or network firewall allow-rule for
source `192.168.0.188` and deny other sources to TCP 4173. The trusted proxy is
only the verified Synology host `nas.lan.pabben.no` at `192.168.0.188`; direct traffic from other
LAN addresses cannot supply trusted forwarding headers. Confirm the immediate
peer after the first tunneled request and after network changes; never trust an
entire LAN subnet or set proxy trust to `true` or `*`. The app does not redirect
internal HTTP to HTTPS. Pangolin terminates TLS, so this avoids a redirect loop
while cookies remain `Secure` because the canonical public origin uses HTTPS.

Configure the existing Pangolin/Newt resource on the Synology as follows:

| Pangolin field | Value |
| --- | --- |
| Public hostname | `samvev.pabben.org` |
| Target protocol | `HTTP` |
| Target host | `192.168.0.144` |
| Target port | `4173` |
| Health path | `/api/v1/health` |
| Pangolin authentication | `Off` |

Have Pangolin/Traefik discard client-supplied `Forwarded`,
`X-Forwarded-Proto`, and `X-Forwarded-Host`, then set
`X-Forwarded-Proto: https` and `X-Forwarded-Host: samvev.pabben.org`. It must
replace or correctly append `X-Forwarded-For` with the authenticated client
chain rather than pass an unverified value unchanged. Preserve the public
`Host` header when that option is available. Disable response buffering for
`/api/v1/display/events` and keep the upstream idle timeout longer than the
15-second SSE heartbeat. No WebSocket configuration is needed.

Pangolin authentication stays off because Samvev validates its own member
sessions and paired-display credentials. Health and the claimed setup status
are intentionally anonymous; household, admin, message, AI, display projection,
and live-display data remain protected by Samvev authentication and permissions.
Use `https://samvev.pabben.org` both at home and away, and sign in there again
after the change. Open `https://samvev.pabben.org/display` and pair each display
again after moving from localhost because host-scoped cookies do not transfer
between origins. The localhost browser URL is only for the initial private setup.

`claude.lan.pabben.no` resolved to the same address during deployment, but use
the numeric target unless the Synology resolver also confirms that hostname.
Direct `http://192.168.0.144:4173` is an internal reachability and health target,
not an authenticated browser origin. Its HTTP Origin is rejected for mutations,
and HTTPS-configured session/display cookies remain `Secure`; users
continue to sign in through `https://samvev.pabben.org`. This also means direct
LAN requests cannot create an alternate insecure session path.

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
- New hashed frontend assets written by a build are resolved dynamically; an
  API restart is not needed merely for a new asset hash. Missing `/assets/*`
  paths return JSON 404 responses, never the SPA HTML. Restart the scoped app
  only when backend code changes must be loaded.

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
