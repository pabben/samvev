# M1 backup restore gate

Verified: 2026-09-20 UTC. Result: **PASS**.

This drill verifies that a retained backup from the deployed Samvev candidate can
be restored into PostgreSQL and read through the matching application runtime.
It did not restore into, restart or reconfigure the live database.

## Source and immutable runtime

- Backup: `samvev-post-lillesand-e2e-f82951b-20260920T170935Z.dump`
- Format: PostgreSQL custom archive, 171,525 bytes, mode `0600`
- SHA-256: `19431d1b3a12b0a3ad0d30a09a0ea57df3baa8c387139087f9dc1949ec0c05c4`
- Archive source: PostgreSQL 17.11; `pg_restore --list` parsed the archive
  successfully
- Restore target: existing `postgres:17.11-bookworm` image
- Application: existing immutable runtime for
  `f82951b67cf1fcc6f0c6f1be673ae40ee3562cf6`

The original archive was mounted read-only and remained checksum-identical after
the drill.

## Isolation

The restore used a new internal Docker network, a new temporary PostgreSQL
volume and separate database/app containers. The database published no host
port. The app published no host port, used a read-only root filesystem and was
connected only to the internal restore network. No worker was started, so the
restored schedules and executions could not run. No live volume, live network,
working tree, Git directory, dependency directory or production secret was
mounted.

Before and after snapshots matched for the live app, worker and database
container IDs, image IDs, restart counts, health states and live database volume.

## Restore and database checks

The target began with zero public tables. The custom archive was restored with
`pg_restore --exit-on-error --single-transaction --no-owner --no-privileges`.
It exited successfully with an empty error log and produced the expected 31
public application tables.

Post-restore verification passed:

- the supported Samvev migrator accepted the restored ledger without applying a
  migration or reporting a checksum mismatch;
- migrations 001–016 were each present exactly once and matched the SQL files in
  the immutable candidate;
- 77 public indexes, 60 foreign keys and 104 check constraints were present;
- no public index was invalid and no constraint was unvalidated;
- installations, households, people, accounts, memberships, messages, displays
  and monitor history were present without logging row content;
- the single synthetic live-E2E registration retained valid household, account
  and membership links;
- no queued or running monitor execution existed in the restored snapshot; and
- `pg_amcheck` completed successfully for the restored database. The `amcheck`
  extension was installed only in the disposable clone for this read-only
  integrity check.

## Application checks

The exact immutable runtime started against the restored database without a
schema mismatch. The following checks passed through ordinary application
interfaces:

- health and the frontend index returned HTTP 200;
- anonymous `/api/v1/me` returned HTTP 401;
- the retained synthetic E2E account logged in through normal authentication;
- its session resolved to exactly its synthetic household membership;
- authorized reads of synthetic people, messages, displays and tasks succeeded;
- normal logout returned HTTP 204; and
- the former session returned HTTP 401 after logout.

No owner account or real-household response body was read or recorded. Login and
logout wrote only to the disposable restored database.

## Cleanup and scope

The isolated app and PostgreSQL containers, internal network and temporary volume
were removed. Clone-only environment files and the generated database password
were removed. Direct and public live health remained HTTP 200, anonymous live
`/api/v1/me` remained HTTP 401, and the recorded live container/volume snapshot
was unchanged. No build, image download, live migration, live restart or deploy
occurred. Available disk space remained approximately 2.9 GiB.

This closes the technical backup-restore gate for the current PostgreSQL 17 / f829
candidate. It does not claim recovery of external provider secrets, a PostgreSQL
major-version migration or restoration of the historical M1-only backup.

Physical display validation is **DEFERRED BY OWNER, NOT YET VERIFIED and
NON-BLOCKING for current development and merge**. This is accepted process risk,
not a physical-test PASS. A later follow-up must validate the actual Shelly Wall
Display XL and actual kitchen iPad/large shared display, including cold
load/reload, SSE/reconnect, touch, scrolling/clipping, readability at distance
and light/dark/system modes. It must also record device model, firmware/browser
or kiosk path, session persistence, usable performance and any observed device
limitations.
