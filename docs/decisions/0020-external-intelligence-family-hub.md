# ADR 0020: External Intelligence uses scoped connections and durable family-hub items

- Status: Accepted for M3 implementation
- Date: 2026-09-24

## Context

Samvev needs a stable way for Home Assistant and other external systems to publish already-derived family information without making any one source or AI provider the product boundary. Browser sessions are inappropriate for machine clients, and a household-wide webhook secret would make rotation, audit and least-privilege authorization difficult. Shared displays also need a stricter disclosure boundary than signed-in household views.

## Decision

Model each external system as a stable, household-scoped `integration_connection`. A connection may have several separately named credentials so credentials can be rotated without changing item identity. Credentials are opaque bearer tokens, shown only in their creation response, stored only as hashes, optionally expiring, individually revocable and scoped to explicit `integration.items.read`, `integration.items.write` and `integration.items.delete` capabilities. Browser administrators use the existing `household.manage` capability to manage connections; integration capabilities never grant browser administration.

External systems publish one of six strict item kinds: `reminder`, `alert`, `event`, `summary`, `list` or `observation`. They share one additive database model with structured targets, list entries, schedule fields, bounded provenance and tightly allowlisted metadata. `publishAt` controls visibility independently of an event's `startsAt` and `endsAt`. Source URLs are limited to non-credentialed HTTP(S) URLs and retain observation/generation timestamps and uncertainty.

Identity is `(connection_id, external_id)`. Creation requires `expectedRevision: 0`; a material update requires the current positive revision. The server computes a canonical payload hash after normalizing target order and timestamps. An identical retry is a no-op even when its supplied revision is stale. Concurrent material updates using the same revision have a single winner. Withdrawal increments the revision and leaves a permanent tombstone; an external ID cannot be resurrected.

Machine mutation routes use bearer authentication only and have a narrow missing-Origin exemption. Foreign Origins remain rejected. Invalid authentication is rate limited before credential lookup, and valid requests receive separate credential limits. Write and withdrawal transactions lock the stable connection before the concrete credential and revalidate revocation, expiry and capability in the same transaction. Admin revocation uses the same lock order. Audit identifies the stable connection as actor and records the concrete credential ID/revision without content or secret values.

Signed-in household members read a server-filtered `/home` projection. Household managers may see all household-targeted and person-targeted items for person columns; other members see household items and items targeted to themselves. The existing birthday `/dashboard` contract stays unchanged.

A paired display receives an external item only when all three grants exist:

1. the item explicitly targets that display ID;
2. the item's connection is granted to that display; and
3. the display has explicitly enabled external items (default `false`).

Privacy mode suppresses the entire hub. Display projections omit source links, action URLs, other display IDs and unrelated person names. Existing message cards and render acknowledgements retain their M1 semantics; external hub items are not falsely marked displayed or read.

PostgreSQL notifications invalidate both display and signed-in member projections. SSE streams periodically revalidate authorization and clients retain polling as fallback. The projection remains a current read model: expiration and publication windows are filtered again whenever it is fetched, independent of notifications.

## Consequences

Connections remain stable through token rotation and retries, while a leaked credential can be revoked without renaming external IDs. Strict schemas mean new item kinds or metadata require an explicit contract and additive migration. Permanent tombstones prevent accidental recreation but require a new external ID when a withdrawn concept is intentionally replaced.

Display publication needs deliberate setup in both connection and display administration, plus explicit item targeting. This adds steps but makes disclosure auditable and default-deny. Revoking a connection hides all its accepted items immediately; revoking one credential stops future access without deleting already accepted items.

Migration 017 is additive. Code rollback leaves the new tables and display column unused. Database rollback is export-and-restore rather than destructive down migration.
