# ADR: Internationalize from the first implementation

- **Status:** Accepted
- **Date:** 2026-09-06

## Context

The project should be usable and contributable beyond Norway without a later rewrite, while the first household needs Norwegian.

## Decision

Use English and Norwegian Bokmål as initial locales; externalize strings; separate locale from time zone; allow per-user and per-display language.

## Consequences

Components must tolerate text expansion. Developer identifiers and API contracts use English.
