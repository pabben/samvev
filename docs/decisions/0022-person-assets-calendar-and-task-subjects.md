# ADR 0022: Protected person assets, calendar snapshots and task subjects

Date: 2026-10-14. Status: Accepted for the authorized M3 round-9 test candidate.

## Context

People may have no login. Calendar ownership, the people an event concerns and
its readers are different concepts. Attaching existing approved AI tasks to a
person must not change execution authorization or schedule.

## Decision

- Store only server-decoded, oriented, cropped and EXIF-free WebP variants in
  PostgreSQL bytea. Bound upload bytes/pixels. Person photo revisions remain
  monotonic across delete/replacement. Every image request checks current
  household or exact active paired-display projection access; no public asset
  directory or permanent anonymous URL.
- Use additive migrations 021–023; preserve prior ledger/checksums. Task subjects
  have independent revisions/audit. The metadata service verifies an active
  household manager and active same-household persons. It does not interpret,
  activate, dispatch, copy a task, alter targets/approval/provider or cadence.
  Person summaries require household-management authority and distinguish older
  valid results from a failed latest run; child/display projections omit them.
- Calendar adapters persist connection/owner, source, separate subjects/readers/
  displays, sync attempts and occurrence incarnation. Fetch every bounded page
  before atomically reconciling. Fence source revisions, connection generation,
  expired leases and withdrawn authority. A restored cancelled occurrence gets
  a new incarnation instead of resurrecting a tombstone. No calendar writes.
- OAuth uses PKCE, expiring single-use state bound to the initiating authenticated
  session, encrypted staged callbacks, verified account binding and connection/
  owner-specific vault AAD. Restrict provider pagination origins and redirects.
  ICS secret URLs use public-address DNS pinning on every redirect. Generic
  integration revocation also fences calendar state; internal rows stay out of
  the generic management list.
- Spond reuses a selected connected Google/Outlook source. It is not a Spond
  private API or a promise to read local-only phone calendars.
- The ChatGPT helper uses the installation's canonical VM host identity and
  existing owner-bound OAuth registration. A restricted runtime importer uses
  the actual immutable app image/network/vault. Guide progress, server-auth
  state, quota and actual inference evidence stay separate.

## Consequences and rollback

Bytea simplifies atomic database/photo backup at the cost of database size;
there is no original image to recover. Before public writes, restore a current
backup to an isolated candidate, migrate, save synthetic photos, back up again
and restore/read the same variants in a second clone. Keep private dumps,
immutable previous images and actual operator receipts. Old application
read-compatibility does not guarantee old-code writes against new schemas.
Prefer image rollback only with verified compatibility; destructive schema/data
rollback requires an explicit recovery choice and may lose post-backup writes.

Full snapshots have bounded retention (−7/+180 days) rather than incremental
provider cursors. Real OAuth registration, consent, subscriptions and Spond
cloud visibility remain external tests. Synthetic transports prove behavior,
not a live account. No automatic paid provider fallback or consent is added.
