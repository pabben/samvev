# M1 API contract

Status: implemented M1 handoff. Base path: `/api/v1`. JSON requests must use
`Content-Type: application/json`. Timestamps are ISO 8601 UTC instants or
offset-bearing instants. The API does not accept local wall-clock timestamps,
which avoids ambiguous or nonexistent daylight-saving times. Household IANA
time zones are validated independently and returned by `/me` for client display.

## Browser security contract

Member authentication uses the opaque `samvev_session` cookie. It is
`HttpOnly`, `SameSite=Strict`, scoped to `/`, and expires after 12 hours. Login
and claim responses also set `samvev_csrf`, a readable `SameSite=Strict` CSRF
token, and return the same value as `csrfToken`. The CSRF token is not an
authentication credential. On every member mutation, send:

```http
Cookie: samvev_session=...; samvev_csrf=...
X-CSRF-Token: <value of samvev_csrf>
```

`GET /api/v1/me` returns `csrfToken` again after a page reload. Unsafe requests
with an `Origin` header must match `SAMVEV_PUBLIC_ORIGIN`, or the current local
origin when that variable is absent. Member cookies are never accepted as
display authority.

Display authentication uses the independent opaque `samvev_display` cookie.
It is `HttpOnly`, `SameSite=Strict`, scoped only to `/api/v1/display`, expires
after 90 days, and can be revoked without changing member sessions. JavaScript
must never store or read this credential. Pairing uses an in-memory verifier:
generate at least 32 random bytes, encode base64url, send its SHA-256 hex digest
to pairing start, and retain the verifier in the display page only until the
one-use redemption completes.

Production enables `Secure` on both credential cookies. M1 local HTTP does not.

## Errors and validation

Every error is localizable by stable code; the API does not return English
user-facing messages:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "requestId": "req-4",
    "details": { "reason": "cannot_grant_capability_not_held" }
  }
}
```

Codes are `BAD_REQUEST`, `VALIDATION_FAILED`, `UNAUTHENTICATED`,
`CSRF_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `REVISION_CONFLICT`,
`RATE_LIMITED`, `INSTALLATION_CLAIMED`, `CLAIM_EXPIRED`, `PAIRING_EXPIRED`,
`PAIRING_INVALID`, `SCHEDULE_INVALID`, and `INTERNAL_ERROR`. Validation details
contain only `{path, code}` items. `NOT_FOUND` is deliberately also used for a
household outside the signed-in account's scope.

## First run and demo

`GET /setup/status` is public:

```json
{
  "claimed": false,
  "setupStep": "welcome",
  "locale": "en",
  "demo": false,
  "demoAvailable": true
}
```

`POST /setup/begin` creates or rotates a 15-minute browser claim token:

```json
{ "claimToken": "opaque-value", "expiresInSeconds": 900 }
```

`POST /setup/claim` is atomic. Only one racing request can succeed:

```json
{
  "claimToken": "opaque-value",
  "owner": {
    "displayName": "Avery",
    "email": "avery@example.invalid",
    "password": "at-least-12-characters"
  },
  "household": {
    "name": "Our household",
    "timezone": "Europe/Oslo",
    "locale": "nb"
  },
  "preferences": { "locale": "nb", "theme": "system" }
}
```

Success sets the member cookies and returns:

```json
{
  "csrfToken": "opaque-csrf-value",
  "householdId": "uuid",
  "membershipId": "uuid",
  "setupStep": "people"
}
```

`GET /setup/progress` and authenticated `PATCH /setup/progress` with
`{"setupStep":"people|display|complete"}` make the post-claim wizard resumable.

When `SAMVEV_DEMO_MODE=true`, the welcome page may explicitly call
`POST /setup/demo`. It never runs automatically. It claims only a fresh
installation and persists a clearly marked synthetic installation, four
people, two optional accounts, an immediate sample, and an accelerated
scheduled sample. The response has `demo:true` and the synthetic administrator
credentials. The checked-in demo credentials are:

```text
admin@demo.invalid / Synthetic-demo-pass-42
member@demo.invalid / Synthetic-demo-pass-42
limited@demo.invalid / Synthetic-demo-pass-42
```

## Sessions and preferences

- `POST /auth/login`: `{"email":"...","password":"..."}`; returns
  `{"csrfToken":"..."}` and sets cookies.
- `POST /auth/logout`: member auth and CSRF required; returns 204 and clears
  both cookies.
- `GET /me`: account `{id,email,locale,theme}`, `csrfToken`, and memberships.
  Each membership includes `id`, `household_id`, `person_id`, `role_preset`,
  `capabilities`, `revision`, `household_name`, `timezone`, `household_locale`,
  `display_name`, and `display_ids`.
- `PATCH /me/preferences`: one or both of `locale: en|nb` and
  `theme: light|dark|system`. Preferences persist on the account.

Database-backed sessions are revocable and passwords use Node's scrypt with a
random per-password salt (`N=32768`, `r=8`, `p=1`). Login, claim, pairing start,
approval, and redemption use durable rate-limit buckets.
Login performs the same fixed scrypt verification path for unknown and disabled
accounts, returns the same `UNAUTHENTICATED` response, and applies both an
aggregate IP limit and the narrower IP/email limit. Rate buckets older than one
hour are removed through the indexed cleanup path.

## Roles, capabilities, and people

Role presets initialize explicit grants; authorization always reads the stored
grant array. M1 capabilities are:

```text
installation.manage
household.view
household.manage
people.manage
account.manage
capability.manage
message.create.household
message.publish.display
message.schedule
message.manage.household
display.manage
```

An administrator cannot grant a capability they do not hold. A household
administrator cannot create, edit, or demote an installation administrator.
Installation-administrator and household-administrator roles, plus management
capabilities, require an active login. The final usable installation owner and
household manager are protected under a serialized installation lock. An
alternative counts only when its account is active and it holds both the
relevant management capability and `capability.manage`; a role label or
no-login person is insufficient. A limited member's empty `displayIds` means no
permitted displays; it is never a wildcard.

`GET /households/:householdId/people` needs `household.view`. All members receive
person labels, age groups, roles, revisions, and whether a login exists.
Effective capability and display-grant details require `people.manage`; login
email requires `account.manage`. Callers with `people.manage` or
`account.manage` also receive boolean `has_active_login`: it is true only when
the person has an account whose `disabled_at` is null. It is false for disabled
accounts and people without a login, and is omitted for callers with neither
management capability. This field contains no account identifier or credential
data. These checks are independent so the frontend must test the current
membership for each capability instead of treating either one as a general
people-administration flag.

`POST /households/:householdId/people` needs `people.manage`:

```json
{
  "displayName": "Robin",
  "ageGroup": "teen",
  "rolePreset": "limited",
  "capabilities": [
    "household.view",
    "message.create.household",
    "message.publish.display",
    "message.schedule"
  ],
  "displayIds": ["paired-display-uuid"],
  "login": {
    "email": "robin@example.invalid",
    "password": "at-least-12-characters",
    "locale": "en",
    "theme": "system"
  }
}
```

Omit `login` to create a person without an account. Multiple no-login people
are supported for member/limited profiles without management grants.
`capabilities` may be omitted to use the selected preset. Creating a person
always requires `people.manage`; including `login` additionally requires
`account.manage`. Elevated roles or management grants are rejected without a
login.

`PATCH /households/:householdId/memberships/:membershipId` needs
`capability.manage` and replaces the explicit policy using optimistic locking:

```json
{
  "rolePreset": "limited",
  "capabilities": ["household.view", "message.schedule"],
  "displayIds": ["uuid"],
  "expectedRevision": 2
}
```

## Display pairing and administration

The display starts pairing without authentication:

```http
POST /display/pairing/start
{"verifierHash":"64-lowercase-hex-sha256"}
```

It receives `pairingId`, a six-digit `code`, and `expiresAt` five minutes in the
future. It may poll `GET /display/pairing/:pairingId/status`, which returns
`approved`, `redeemed`, `expired`, and `expiresAt` without household data.

An administrator with `display.manage` approves:

```http
POST /households/:householdId/displays/pairing/approve
{"code":"123456","name":"Kitchen","locale":"nb","theme":"dark","privacyMode":false,"allowedContent":"household_messages"}
```

The display redeems exactly once:

```http
POST /display/pairing/redeem
{"pairingId":"uuid","verifier":"original-base64url-verifier"}
```

Success sets the display cookie and returns display metadata. Racing or expired
redemptions fail. `GET /households/:householdId/displays` lists displays.
`PATCH /households/:householdId/displays/:displayId` accepts `locale`, `theme`,
`privacyMode`, or `revoked:true`. Revocation is terminal for that credential;
pair again to reconnect. Pending queued deliveries become `failed` with
`DISPLAY_REVOKED`; already displayed timestamps remain historical evidence.

## Messages

`GET /households/:householdId/messages` needs `household.view` and returns up to
200 visible messages. A member sees authored messages, person-targeted messages,
and household-audience messages; `message.manage.household` sees all. Rows expose
author label/person, audience IDs, `can_edit`, revision, lifecycle state, and
per-display delivery objects. Each row also contains the narrow visible change
history `activity: [{action, actorName, occurredAt}]`, where `action` is
`edited` or `withdrawn`. It contains no old bodies, account IDs, or generic
audit metadata. The original `author_name`/`author_person_id` never changes when
an administrator edits or withdraws another member's message.

Create with `POST /households/:householdId/messages`:

```json
{
  "body": "Remember gym clothes tomorrow",
  "importance": "attention",
  "audience": {
    "household": false,
    "personIds": [],
    "displayIds": ["kitchen-display-uuid"]
  },
  "publishAt": "2026-09-07T05:00:00Z",
  "expiresAt": "2026-09-07T08:00:00Z",
  "idempotencyKey": "browser-generated-key-0001"
}
```

Omit `publishAt` to publish immediately. `expiresAt` must be after publication
and still in the future. Creating needs `message.create.household`; a future
start also needs `message.schedule`; any display target needs
`message.publish.display`. Non-display-admin members can target only IDs in
their current explicit display grants. Household audience does not imply any
display target, so messages never leak to every display.
Repeating the same `idempotencyKey` and payload returns the original message;
reusing that key for a different payload returns `CONFLICT` with reason
`idempotency_payload_mismatch`.

`PATCH /households/:householdId/messages/:messageId` accepts optional `body`,
`importance`, complete `audience`, `publishAt`, `expiresAt`, plus required
`expectedRevision`. The author may edit a scheduled or published message while
still authorized for all current targets; an administrator needs
`message.manage.household`. A stale revision returns `REVISION_CONFLICT`.

`POST /households/:householdId/messages/:messageId/withdraw` with
`{"expectedRevision":2}` changes scheduled to `cancelled` and published to
`withdrawn`. Display deliveries become `cancelled` and projections invalidate.

Lifecycle states are `draft`, `scheduled`, `published`, `cancelled`,
`withdrawn`, `expired`, and `failed`. M1 creates scheduled/published messages;
draft and failed message states are reserved for later authoring/job failures.
Delivery states are separate: `queued` means publishable for the target,
`delivered` means included in a projection requested by that authenticated
display, `displayed` means the client acknowledged rendering that exact
revision, `cancelled`, `expired`, or `failed`. Displayed never means a person
read the card.

## Restricted display runtime

`GET /display/projection` requires only the display cookie. The allowlisted
response has no account IDs, recipient IDs, private source fields, unpublished
bodies, or messages that merely use household audience. Only current published
messages explicitly targeted to this display appear:

```json
{
  "display": {
    "id": "uuid",
    "name": "Kitchen",
    "householdName": "Our household",
    "timezone": "Europe/Oslo",
    "locale": "nb",
    "theme": "dark",
    "privacyMode": false
  },
  "cards": [{
    "id": "uuid",
    "kind": "household_message",
    "body": "Remember gym clothes tomorrow",
    "importance": "attention",
    "author": "Robin",
    "publishAt": "2026-09-07T05:00:00.000Z",
    "expiresAt": "2026-09-07T08:00:00.000Z",
    "revision": 1
  }],
  "serverNow": "...",
  "generatedAt": "...",
  "cacheUntil": "...",
  "maxStaleSeconds": 900
}
```

`cacheUntil` is the projection's hard reload/cache deadline, exactly 15 minutes
after `generatedAt` in M1. It is independent of card expiry. Clients must remove
each card individually at its own `expiresAt` while retaining later cards and
display metadata, discard all cached projection data at `cacheUntil`, clear
immediately on 401 or the SSE revocation event, show stale state while
polling/SSE is unavailable, and disable actions offline. Privacy mode returns
zero cards.

`GET /display/events` is an SSE stream. It sends `ready`,
`projection-invalidated`, 15-second `heartbeat`, `authorization-revoked`,
`listener-degraded`, and `listener-restored`. `ready` contains
`generatedAt`, `listenerConnected`, and `pollingFallback`; every heartbeat
contains `serverNow` plus the latter two fields. A stream opened during a
listener outage therefore starts with `listenerConnected:false` and
`pollingFallback:true` and immediately receives `listener-degraded`.

`listener-degraded` contains `pollingFallback:true`, the current
`listenerConnected` value, and reason `notification-listener-unavailable` or
`authorization-check-unavailable`. Immediately stop presenting realtime as
Live and continue projection polling. A transient database error during the
regular credential recheck degrades the stream; it does not claim the display
was revoked or discard its cache. A verified invalid or revoked credential
sends `authorization-revoked` and closes the stream.

`listener-restored` contains `pollingFallback:true`, `listenerConnected:true`,
and `refetchRequired:true`. Refetch the projection, then disable the polling
fallback and restore Live state. Subsequent heartbeats report
`pollingFallback:false`. Fetch after every invalidation and retain polling as
fallback. Stream authorization is revalidated regularly.
One dedicated PostgreSQL listener fans notifications out in process; SSE
connections do not reserve normal API pool slots. M1 bounds streams to 100 per
API process and 12 per display by default; an excess stream receives 429.

After a card is actually painted, call `POST /display/render-ack`:

```json
{"cardId":"message-uuid","revision":1,"renderedAt":"2026-09-07T05:00:01Z"}
```

The server locks and rechecks display target, household, current message state,
window, and exact revision. Privacy-mode, expired, withdrawn, wrong-display,
cross-household, and stale-revision ACKs fail. ACK is idempotent.
ACK requests have a durable per-display rate bound.

## Scheduler, migrations, and test commands

The worker polls each second. One transaction selects only due scheduled or
expiring rows with `FOR UPDATE SKIP LOCKED`, changes lifecycle state, records a
unique lifecycle event, updates deliveries, and commits. A schedule whose whole
window elapsed while the worker was stopped becomes `expired` without a brief
publication. Multiple workers/restarts are idempotent.

Migrations in `services/api/migrations` are ordered, SHA-256 checksummed in
`schema_migrations`, and serialized with a PostgreSQL advisory lock. Changed
applied SQL fails closed. There are no automatic destructive down migrations.
Migration 004 adds only the rate-limit cleanup index; migrations 001–003 remain
unchanged.

Run all backend checks in project-labeled containers:

```bash
bash scripts/m1.sh lock
bash scripts/m1.sh install
docker compose --project-directory /home/administrator/apper/samvev \
  --env-file /home/administrator/apper/samvev/.env.example \
  -p samvev-m1 -f /home/administrator/apper/samvev/compose.yaml \
  --profile tools run --rm tools npm run check
bash scripts/m1.sh test
```

The integration suite refuses to truncate unless `DATABASE_URL` names
`samvev_test` on host `test-db`. Test coverage includes claim/redeem races,
pairing expiry, multiple no-login people, role escalation denial, owner
protection, explicit limited-display grants, cross-household read/target/ACK
denial, optimistic revisions, render ACKs, privacy/revocation, scheduling,
missed-window expiry, idempotency, starvation resistance, and migration reruns.
Gate E coverage also proves removed-target non-resurrection, no-login/disabled
administrator exclusion and legitimate ownership transfer, split people/account
capabilities, dummy login verification and aggregate limits, safe change
attribution, attention ordering, independent card expiry, and ten concurrent
SSE streams without normal-pool starvation or shutdown leaks.
