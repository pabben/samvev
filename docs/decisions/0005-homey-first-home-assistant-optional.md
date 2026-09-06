# ADR: Make Homey first-class and Home Assistant optional

- **Status:** Accepted
- **Date:** 2026-09-06

## Context

The initial household already uses Homey. Requiring Home Assistant would add work and exclude other users.

## Decision

Implement Homey notifications, inbound events and allowlisted Flow actions. Offer Home Assistant as a separate optional adapter with agent-generated setup.

## Consequences

Core shared displays and notifications cannot depend on Home Assistant. Integration contracts must support both systems independently.
