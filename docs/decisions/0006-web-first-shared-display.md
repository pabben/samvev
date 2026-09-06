# ADR: Use a responsive web client for the first shared display

- **Status:** Accepted
- **Date:** 2026-09-06

## Context

Kitchen tablets, large displays, fridge browsers and wall panels require a common display surface before device-specific applications are justified.

## Decision

Build the first shared display as a restricted responsive web client with pairing, live updates, light/dark themes and offline stale-state handling.

## Consequences

Device-specific limitations still require validation. The web client must not run as an administrator session.
