# Instructions for coding agents

This repository is documentation-first and does not yet contain a production application.

## General rules

- Read `README.md`, `docs/PRODUCT_REQUIREMENTS.md`, `docs/ARCHITECTURE.md` and relevant ADRs before changing architecture or product behavior.
- Work in a branch. Do not merge, tag, release, deploy or modify production systems without an explicit instruction.
- Keep changes focused and reversible.
- Add tests for behavior and migrations.
- Never add real household, child, location, calendar or credential data.
- Do not fabricate support for an external API. Mark assumptions and add an integration validation issue.
- Preserve source links, timestamps and uncertainty for AI-derived content.
- Enforce permissions server-side, including display and child accounts.
- User-facing text must be localizable. Initial locales are `en` and `nb`.
- New UI must account for iPhone, shared display and compact wall-panel behavior where relevant, in light and dark modes.

## Validation before completion

A completion report should include:

- files changed
- tests and checks run
- unresolved risks or assumptions
- migration and rollback notes when relevant
- screenshots for visual changes
- confirmation that no secret or private data was introduced

## Git workflow

- Use Conventional Commit-style subjects where practical.
- Sign off commits using `git commit -s`.
- Do not rewrite shared history.

<!-- SAMVEV_MULTI_AGENT_ORCHESTRATION_START -->
## Samvev multi-agent orchestration

- The main agent is the sole coordinator and integrator; automatically use the defined project agents for substantial work.
- First run repo_scout, requirements_guardian, solution_architect and ux_designer in parallel and wait for all.
- Writing agents work sequentially in the same worktree. Never let two writing agents modify the same file set concurrently.
- After implementation, run security_reviewer, requirements_guardian and ux_designer in parallel.
- Route confirmed findings to the responsible writing agent, one writer at a time.
- qa_engineer performs a complete retest; release_gate runs last.
- The main agent independently verifies critical claims and keeps docs/implementation/M1_STATUS.md updated.
- Work only in /home/administrator/apper/samvev. Do not inspect or change parent or sibling projects or host-global configuration. No sudo or global installs.
- Docker resources must belong unambiguously to Compose project samvev-m1. No broad prune, host networking, privileged containers or Docker socket mounts.
- No direct main push, force-push, merge, tag, release or production deployment.
<!-- SAMVEV_MULTI_AGENT_ORCHESTRATION_END -->
