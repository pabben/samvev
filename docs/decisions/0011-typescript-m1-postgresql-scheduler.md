# ADR: TypeScript M1 with PostgreSQL-backed scheduling

- **Status:** Accepted for M1 implementation
- **Date:** 2026-09-06

## Context

The first bounded slice needs multi-user scheduled messages and a restricted
display. The architecture's Python API was explicitly provisional. Host Node
is absent, Docker is usable, and all runtime resources must belong to Compose
project `samvev-m1`. No external integrations are required or permitted in M1.

## Decision

Use React/Vite for the web application and Fastify for a same-origin versioned
API serving built assets. Use PostgreSQL and a separate TypeScript worker from
the same codebase, with shared domain/contracts and semantic design tokens.
Compose app, worker and db services are persistent; tools/test services run
within the same project. Do not introduce Redis or a distributed job queue.

Use ordered SQL migrations with checksums, a ledger and migration locking.
Persist schedules as timezone-aware instants with an independent household IANA
timezone. Transactional row locking, idempotency constraints and lifecycle events
make publication, expiry, edit and withdrawal safe across restarts/concurrency.

Use first-party hashed-password authentication and opaque revocable database
sessions. Keep person, account, membership and explicit capabilities separate.
Enforce household scope and target relationships server-side and in constraints.
First ownership claim is atomic and closes after success. Default local binding
is loopback; no public deployment is performed by this milestone.

Displays initiate pairing with a short-lived code plus a browser-bound high
entropy verifier. An authorized administrator approves; the display redeems once
for a separate restricted credential. Display APIs never inherit member access.

SSE signals updated projections with polling fallback. Projection fields are
allowlisted and current; device render ACK records displayed separately from
publication and never proves human reading. Offline projection caches expire
individual cards and clear at a maximum 15-minute deadline or upon explicit
revocation/authorization failure. No privileged actions run offline.

## Consequences

The deployment stays small while preserving web/API/worker extraction paths.
All tooling runs in project-labeled containers without global host installs.
Offline revocation has a bounded delay while a device cannot contact the server.
Local first-party authentication is not a claim of completed production recovery
or MFA. Schema and API changes after real data would require careful migration.

Browser viewport checks cover phone, 16:9 and Shelly XL 1280×752; actual hardware
and firmware compatibility require separate validation. AI, Homey, Home Assistant,
calendars, Spond, Keep, iOS, rewards and voice remain deferred without fake adapters.
