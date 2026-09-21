# M1 implementation plan

Authority: kickoff, repository product documentation, latest user constraints.
Branch: `feat/m1-first-runnable-slice`. Compose project: `samvev-m1`.

## Gates and ownership

Only the coordinator integrates and commits. All writers work sequentially in
the shared worktree; reviewers never write. No agent spawns additional agents.

1. **Gate A:** repo_scout, requirements_guardian, solution_architect and
   ux_designer read-only discovery in parallel; wait for all. Completed.
2. **Gate B:** coordinator writes discovery, this plan, status, retained first
   slice checklist and ADR 0011 before scaffolding.
3. **Gate C, sequential writers:**
   - devops_engineer: Compose, Dockerfiles, `.env.example`, root package/build
     foundation, safe developer/test commands, operation docs and helper scripts.
   - backend_engineer: API, core/contracts, SQL migrations, worker, seed data,
     backend tests and the versioned API handoff. May adapt root package files
     while holding the only writer slot.
   - frontend_engineer: `apps/web`, design tokens, externalized locales,
     onboarding, people, messages, pairing/display, demo/workbench, initial
     browser evidence. May adapt build configuration in its writer slot.
   - qa_engineer: test infrastructure, meaningful unit/integration/E2E,
     accessibility and visual regression suites, executed evidence artifacts.
4. **Gate D:** security_reviewer, requirements_guardian and ux_designer review
   implementation/evidence in parallel; wait for all.
5. **Gate E:** coordinator confirms findings; responsible writer fixes them one
   at a time. qa_engineer runs a complete retest. release_gate runs last.
   Repeat fixes/retest/release review until verified PASS or real external blocker.
6. Coordinator independently verifies critical runtime/security/test claims,
   updates final documentation, makes signed-off commits, pushes work branch and
   creates a draft PR against main. Leave the scoped Docker stack running.

## Architecture and contract handoff

ADR 0011 selects React/Vite, Fastify and PostgreSQL, with shared TypeScript core
and a separate scheduler process. SQL migrations precede readiness. Versioned
API routes and stable error codes are documented before frontend work begins.
Durable message rows, lifecycle events and deliveries commit atomically; due
rows are locked with `FOR UPDATE SKIP LOCKED`. SSE invalidates projections and
polling repairs missed events. Every request is scoped server-side.

Backend handoff must include exact payloads, routes, cookie/CSRF handling,
capabilities, timezone conversion, errors, display ACK semantics, demo setup,
and commands frontend/QA can execute without host Node.

## Validation and evidence

The authoritative checklist is [M1_FIRST_SLICE.md](M1_FIRST_SLICE.md). Tests must
execute; no skipped or weakened tests count. Record command, result and artifact
path in [M1_STATUS.md](M1_STATUS.md) and any linked test report.

Use synthetic fixtures and isolated Samvev-labeled test services/databases.
Verify a fresh database install, concurrent/idempotent scheduling, real worker
restart, isolation, limited permissions, live display updates, expiry and
withdrawal. Exercise complete browser flows, both locales, all appearances,
offline expiry/revocation, accessibility and stable visual comparisons.

Visual matrix: phone 390×844, 16:9 display 1920×1080 and compact 1280×752,
each in light/dark and en/nb; additional setup, composer, pairing, offline,
empty and long-text evidence. Store sanitized screenshots in documentation
artifacts and label physical-device validation as unexecuted.

## Migration and rollback

Initial SQL schema is additive, versioned and checksummed. Development reset may
delete only explicitly scoped synthetic Samvev data through a documented command.
Do not automatically reset a claimed installation. Roll back code with prior
signed-off branch commits; schema rollback for retained data uses a verified
backup/restore, not destructive automatic down migrations.

## Deferred scope

External integrations, native clients, AI, rewards, voice, production deployment,
physical Shelly certification, recovery/MFA and advanced privacy operations are
not to be advertised as implemented without evidence. Create/document follow-up
validation issues where relevant; no mocked external support.
