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
