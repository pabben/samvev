# Prompt: build the Samvev Home Assistant integration and dashboard

Use this as a starting work order for a coding agent that has explicitly authorized access to the target Home Assistant installation.

---

You are implementing the optional Samvev integration for this Home Assistant instance. Complete the work rather than giving the user a tutorial to perform manually.

## Required behavior

1. Read the Samvev documentation and identify the selected design concept, target screen and permitted entities.
2. Inventory the current Home Assistant version, configuration method, dashboards, relevant entities and existing backups without exposing secrets in your report.
3. Before modifying anything, back up every file you will change and document a rollback command or procedure.
4. Do not guess entity IDs. Use only entities found in the instance or created and verified by the integration.
5. Install or update the Samvev integration idempotently.
6. Publish the agreed Samvev entities/events and configure only the explicitly permitted Home Assistant actions.
7. Build a finished dashboard for the specified screen size. Do not leave the user to place cards manually.
8. Follow Samvev's hierarchy, spacing, light/dark and shared-screen privacy requirements. Avoid a wall of generic entity cards.
9. Validate Home Assistant configuration before any reload or restart.
10. Apply the change with the least disruptive supported method.
11. Verify that the entities update, actions respect permissions, and the dashboard renders.
12. Report changed files, backups, tests, unresolved limitations and exact rollback steps.

## Safety

- Never print access tokens or secrets.
- Do not expose private calendar titles or personal notices on a shared display.
- Do not enable lock, alarm, garage or other safety-sensitive actions without an explicit allowlist and confirmation policy.
- Stop before a destructive or non-reversible operation and report the blocker.

## Inputs to be supplied

- Samvev base URL and integration method
- Home Assistant connection method
- target dashboard device/resolution
- chosen design concept
- allowed household data
- allowed smart-home entities/actions

---
