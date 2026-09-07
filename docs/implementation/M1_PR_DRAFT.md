# Prepared draft PR — not submitted

Target: `main`. Head branch: `feat/m1-first-runnable-slice`.
Submission is blocked by read-only `.git`; the working-tree implementation has
not been committed or pushed. This file is reviewable PR copy, not a PR URL.

## Title

feat: deliver the first runnable Samvev M1 household slice

## Body

Samvev now runs locally from one project-scoped Compose command. An owner can
complete resumable setup, add people with optional logins and explicit roles,
pair a restricted family display, and publish or schedule messages. The display
updates live, removes withdrawn/expired content automatically, and handles
offline cache expiry and revocation without exposing member APIs.

The slice includes English and Norwegian Bokmål, light/dark/system appearance,
phone/shared/Shelly layouts, an optional Person Columns layout and a component
workbench. PostgreSQL transactions, an independent worker and bounded SSE
fan-out provide restart-safe scheduling, honest delivery states and household
isolation. See ADR 0011 and `docs/implementation/M1_DELIVERY.md`.

Validation: 18 unit/integration tests; complete isolated fresh-install QA with
17 smoke, 10 focused and 10 UX checks; a real worker restart with exact durable
transitions; 12 approved visual comparisons with zero differences outside narrow
reviewed time masks; runtime smoke 16 plus focused 10; TypeScript/build, dependency
audit and repository checks. The coordinator independently reran tests and
verified the database ledger, runtime assets and visual evidence. No tests or
accessibility rules were skipped or disabled.

Migrations 001–004 are checksum tracked; rollback of retained data requires a
verified backup, with no automatic down migration. Screenshots and synthetic
demo instructions are linked from the delivery guide. Physical-device and
backup-restore validation remain follow-up work. All fixtures are fictional.
External integrations, AI, native iOS, rewards and voice are outside M1.
