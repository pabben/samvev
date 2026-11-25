# M3 External Intelligence API

Status: implemented locally on `feat/m3-family-hub`; no production integration is configured.

## Contract overview

External Intelligence accepts family information that another trusted system has already fetched or derived. It does not fetch Google Calendar, Spond, school systems, weather, Nest, Home Assistant or OpenAI itself.

The stable identity is an integration connection. Administrators manage it with their normal browser session and `household.manage`. Each connection has separately revocable bearer credentials with one or more capabilities:

- `integration.items.write`
- `integration.items.delete`
- `integration.items.read`

The clear credential is returned once. All browser administration responses use `Cache-Control: private, no-store`; listings contain metadata only. Credentials are hashed at rest and are always confined to their connection and household.

## Browser administration

All administration routes require the normal session cookie, CSRF token for mutations and `household.manage`:

| Method and path | Purpose |
|---|---|
| `GET /api/v1/households/:householdId/integrations` | List connections, grants and credential metadata |
| `POST /api/v1/households/:householdId/integrations` | Create a stable connection and optionally its first credential |
| `PATCH /api/v1/households/:householdId/integrations/:connectionId` | Rename or replace display grants with CAS |
| `POST /api/v1/households/:householdId/integrations/:connectionId/revoke` | Revoke the connection and all credentials with CAS |
| `POST /api/v1/households/:householdId/integrations/:connectionId/credentials` | Create and reveal one credential with connection CAS |
| `POST /api/v1/households/:householdId/integrations/:connectionId/credentials/:credentialId/revoke` | Revoke one credential with credential CAS |

Create example:

```json
{
  "name": "Home Assistant family brief",
  "displayIds": ["00000000-0000-4000-8000-000000000010"],
  "credential": {
    "name": "Family brief writer",
    "capabilities": [
      "integration.items.write",
      "integration.items.delete",
      "integration.items.read"
    ],
    "expiresAt": null
  }
}
```

`PATCH` requires `expectedRevision` and replaces the complete display-grant list when `displayIds` is present. Display administration separately opts in with:

```json
{ "externalItemsEnabled": true }
```

New and paired displays default to `false`.

## Machine item API

Machine routes never use browser or display cookies:

| Method and path | Required capability | Semantics |
|---|---|---|
| `POST /api/v1/integrations/items` | `integration.items.write` | Create, update or identically retry an item |
| `GET /api/v1/integrations/items` | `integration.items.read` | List only this connection's items, including tombstones |
| `GET /api/v1/integrations/items/:externalId` | `integration.items.read` | Read only this connection's matching item |
| `DELETE /api/v1/integrations/items/:externalId` | `integration.items.delete` | Permanently withdraw with `{ "expectedRevision": n }` |

Supported `kind` values are `reminder`, `alert`, `event`, `summary`, `list` and `observation`. Priority is `low`, `normal`, `high` or `urgent`.

Every new item must declare `contentLocale` as `en` or `nb`. The external producer owns translation and should publish separate items with explicit person/display targets when audiences need different languages. Samvev preserves and projects the declared language; it does not translate automatically or hide an item because its content language differs from an account or display locale. Existing development items from before migration 018 retain `contentLocale: null` because their language cannot be inferred safely.

```json
{
  "externalId": "family-brief:2026-09-25:rain",
  "expectedRevision": 0,
  "kind": "reminder",
  "contentLocale": "nb",
  "targets": {
    "household": true,
    "personIds": ["00000000-0000-4000-8000-000000000020"],
    "displayIds": ["00000000-0000-4000-8000-000000000010"]
  },
  "title": "Husk regntøy",
  "body": "Det er meldt regn etter lunsj i morgen.",
  "entries": [],
  "priority": "high",
  "publishAt": "2026-09-24T18:00:00.000Z",
  "startsAt": null,
  "endsAt": null,
  "expiresAt": "2026-09-25T18:00:00.000Z",
  "source": {
    "label": "Syntetisk familiebrief",
    "url": "https://example.invalid/weather?day=tomorrow",
    "links": [],
    "observedAt": "2026-09-24T17:55:00.000Z",
    "generatedAt": "2026-09-24T17:56:00.000Z",
    "uncertainty": "low"
  },
  "metadata": {
    "category": "weather",
    "icon": "rain"
  }
}
```

Targets require at least one household, person or display target. A display target must also be in the connection's grant list. Person IDs and display IDs are validated against the credential-derived household. Person targets alone never imply display publication.

`list` requires one or more `{ "label", "detail"? }` entries. Other kinds reject entries. `event` requires `startsAt`; optional `endsAt` may not precede it. `publishAt` is independent of event time. `expiresAt`, when present, must be after publication and event start.

Source and metadata are strict. Source uncertainty is `low`, `medium`, `high` or `unknown`. URLs permit HTTP(S) without URL user information, credential-like query keys or fragments. M3 conservatively rejects all URL fragments, including benign anchors. Metadata permits only `category`, `icon`, `location`, `allDay` and `actionUrl`. Raw provider responses do not belong in metadata.

Create returns HTTP 201 and `result: "created"`. A material update with the current revision returns HTTP 200 and `result: "updated"`. A byte-equivalent canonical retry returns `result: "unchanged"` without incrementing the revision, even if the retry carries a stale expected revision. A different payload with a stale revision returns `REVISION_CONFLICT`.

Withdrawal keeps a permanent tombstone. Repeating withdrawal is unchanged; posting the same `externalId` later returns a conflict with reason `item_permanently_withdrawn`.

## Curl example

Keep the token in a local secret store. The following values are placeholders:

```bash
SAMVEV_ORIGIN='https://samvev.example.invalid'
SAMVEV_INTEGRATION_TOKEN='replace-with-one-time-token'

curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer ${SAMVEV_INTEGRATION_TOKEN}" \
  --header 'Content-Type: application/json' \
  --data @integrations/home-assistant/synthetic-family-brief.json \
  "${SAMVEV_ORIGIN}/api/v1/integrations/items"
```

Do not include an `Origin` header in a machine request. If one is supplied, it must match the configured Samvev public origin.

## Home and live projection

`GET /api/v1/households/:householdId/home` requires `household.view`, uses `Cache-Control: private, no-store`, and returns household settings, viewer identity, people, the existing birthday summary, relevant current external items, current/upcoming messages and `serverNow`. The older `/dashboard` birthday response remains unchanged.

`GET /api/v1/households/:householdId/events` is a member SSE stream. `projection-invalidated` means refetch `/home`; `authorization-changed` requires an immediate refetch; `authorization-revoked` means clear protected state and stop. Heartbeats carry listener health and preserve the existing polling fallback.

`GET /api/v1/display/projection` preserves existing `cards` and message render ACK behavior. It adds `hub` only when the display is not private and external items are enabled. The hub contains only explicitly display-targeted items from explicitly granted connections. Source links, action URLs, other display IDs and unrelated people are removed server-side. Current publication and expiry windows are evaluated whenever the projection is fetched; clients must also remove expired cached items using `expiresAt` and the projection's existing cache deadline.

## Illustrative Home Assistant handoff

Checked-in [synthetic JSON](../../integrations/home-assistant/synthetic-family-brief.json)
and [manual HA REST/script YAML](../../integrations/home-assistant/synthetic-family-brief.yaml)
show the future boundary. Neither is installed or executed against HA. Update the
sample dates before a later local demonstration; the checked-in example is dated
and will expire. Replace placeholder IDs only with authorized synthetic IDs.

The YAML uses a private `!secret` for the entire Authorization header instead of
passing the bearer secret as script action data. Its manual script accepts an
already-validated item and checks the REST action response. Persist the exact
payload and returned revision outside an AI prompt; retry that payload verbatim.
On 409, read/reconcile the current item with a read-scoped credential before a
material update. Do not blindly retry newly generated text with revision zero.

Home Assistant documents JSON payload/header configuration and action responses
in [RESTful Command](https://www.home-assistant.io/integrations/rest_command/),
and structured generation through an operator-configured provider in
[AI Task](https://www.home-assistant.io/integrations/ai_task/).
Documentation checked 2026-09-24. This supports the illustrative shape only;
actual compatibility, provider setup and secret/log behavior remain unvalidated.

For a future “tomorrow's family brief”, HA collects permitted calendar, school
and weather facts; the AI Task produces concise relevant text/conflicts. A
trusted deterministic step builds separate summary/reminder/event/list envelopes,
assigns authorized people/displays, preserves evidence and uncertainty, and
submits them to Samvev. Never let model output choose credential permissions,
household identity or display grants. Spond, Nest and other HA data are possible
future inputs, not implemented Samvev adapters.

The planned pipeline is:

```text
Google Calendar / Spond / school plan / weather / Nest / other HA data
                         ↓
                  Home Assistant
                         ↓
               OpenAI AI Task (optional)
                         ↓
          Samvev External Intelligence API
                         ↓
       PostgreSQL → SSE invalidation → projections
```

[Integration validation task M3-HA-001](../backlog/M3_INTEGRATION_VALIDATION.md): before describing this as supported, validate the exact `rest_command` templating and secret handling against the chosen Home Assistant release, exercise create/update/withdraw retries, document its timeout/retry behavior and capture only synthetic evidence. Real Home Assistant, OpenAI and household credentials remain out of scope for M3.

## Rollback

Migrations 017 and 018 are additive. Migration 018 leaves prior items nullable rather than guessing their content language; all new API writes require a locale. Rolling application code back leaves the new tables, locale column and `displays.external_items_enabled` unused. Do not drop them to roll back; use a pre-migration backup for a complete database rollback. Revoked credentials and withdrawn tombstones are retained audit state.
