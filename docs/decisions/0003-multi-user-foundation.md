# ADR: Build multi-user and display permissions from the first release

- **Status:** Accepted
- **Date:** 2026-09-06

## Context

Testing with several family members is necessary to discover different needs and avoid retrofitting privacy boundaries later.

## Decision

Separate person profiles, authenticated accounts, households, roles/capabilities and restricted display clients in the first data model.

## Consequences

Initial implementation is more involved than a single-user prototype, but it prevents unsafe client-only separation and enables realistic testing.
