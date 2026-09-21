# Privacy and security design

Samvev may process information about children, school, co-parenting, location, calendars, household presence and physical devices. Privacy and safety are product behavior, not only deployment documentation.

## Data minimization

- Collect only fields needed for the chosen function.
- Birth date is optional. Use an age group when an exact date is unnecessary or unknown.
- Return full birth dates only to authenticated members with person-management
  permission. The signed-in family dashboard receives only the next birthday's
  display name, occurrence date, days remaining and age being reached.
- Do not import entire accounts when a selected calendar, note or folder is sufficient.
- Avoid retaining complete source documents forever without a household policy.
- Keep AI prompts and outputs out of generic logs.

## AI egress policy

Each household can define whether a data class may be sent to:

- local AI only
- approved cloud AI
- no AI

The server evaluates this before provider routing. A prompt instruction alone is not a security control.

## Household isolation

Every query and mutation is scoped by installation, household, membership and capabilities. Tests should include cross-household and cross-user access attempts.

## Shared screens

- receive only an authorized projection
- use a restricted, revocable credential
- default to low-sensitivity content
- offer a privacy mode
- avoid exposing authenticated source URLs or tokens
- require stronger confirmation for sensitive actions

## Secrets

- Provider and integration secrets are stored server-side.
- Secrets are encrypted at rest where deployment capability permits.
- Clients receive short-lived or scoped credentials.
- Public repository examples use placeholders.
- Diagnostics redact tokens, cookies, private URLs and message content.
- Account invitations are random, hashed at rest, expire, and can be accepted
  only once. The clear token is shown or written to a mode-0600 ignored local
  file once and is never written to audit metadata.

## Audit and retention

Audit permission, integration, display-pairing and sensitive-action changes. Retention should be configurable by data class. Users need export and deletion paths.

## Child-related design

- Explain publication audience in simple language.
- Avoid hidden scoring.
- Allow correction and withdrawal where appropriate.
- Do not use manipulative reward mechanics.
- Do not expose children's schedules to a public or broadly shared URL.

## Physical safety

Prefer Homey/Home Assistant allowlisted routines. Lock, alarm, garage, heat and other safety-sensitive actions may require recent authentication, confirmation and audit.

## Threat-model starters

- unclaimed installation takeover
- compromised shared display
- malicious source content attempting prompt injection
- calendar or PDF content causing unauthorized tool calls
- cross-household ID guessing
- webhook replay or forgery
- leaked Homey/AI credentials
- child publishing private information to a shared screen
- AI summary inventing a date or recipient
- stale display causing someone to act on outdated information

Each implementation milestone updates the threat model.
