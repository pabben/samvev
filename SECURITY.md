# Security policy

## Current status

Samvev has no production release yet. Security design and threat modelling are part of the foundation phase.

## Reporting a vulnerability

Do **not** open a public issue containing:

- authentication or authorization bypasses
- secrets, tokens or private URLs
- access to a real household's data
- vulnerabilities involving children, location, locks, alarms or other safety-sensitive actions
- a working exploit against a deployed instance

Until a dedicated security address and GitHub private vulnerability reporting are configured, contact the maintainer privately through the contact method listed on the GitHub profile. Include the affected component, impact, reproduction steps and a safe proof of concept when available.

## Security principles

Samvev intends to enforce:

- server-side authorization for every resource and action
- separate personal, household and display scopes
- least-privilege integration credentials
- explicit confirmation for sensitive physical actions
- encrypted transport and protected secret storage
- audit history for important changes and deliveries
- source traceability for AI-derived notices
- local processing options for sensitive content
- secure first-run ownership claim
- no real household data in fixtures, screenshots or test suites

## Supported versions

No versions are supported yet. This section will be updated before the first release.

## Disclosure process

The project will acknowledge valid reports, assess severity, prepare a fix and coordinate disclosure. Exact response targets will be published when there is an active maintainer team capable of meeting them.
