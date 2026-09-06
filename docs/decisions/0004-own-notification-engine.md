# ADR: Samvev owns durable task and notification state

- **Status:** Accepted
- **Date:** 2026-09-06

## Context

Chat providers can understand a request but should not be the only place where a recurring instruction, run history or delivery state exists.

## Decision

Store confirmed tasks, schedules, source state, runs, notices and deliveries in Samvev. ChatGPT/MCP and the Samvev UI are clients of this engine.

## Consequences

Users can change AI providers or interfaces without losing tasks. The server must implement scheduling, retries, permissions and audit behavior.
