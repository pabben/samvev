# Home Assistant bridge API v1

The native HA adapter uses the existing separately revocable integration bearer
credential, never a browser/display cookie. Base paths below are `/api/v1/ha`.
All responses are `private, no-store`. JSON uses camelCase. Errors use Samvev's
existing `{error:{code,details?}}` envelope; 401 means revoked/expired credential,
403 means missing capability/sharing, 409 means revision/idempotency conflict.

## Authority and sharing

Additional credential capabilities are `ha.groceries.read`,
`ha.groceries.write`, `ha.messages.read`, `ha.messages.write`,
`ha.calendar.read`, `ha.calendar.write`. Write does not imply read. Because a
mutation returns the authoritative complete resource, every bridge mutation
requires both its write capability and its paired read capability; write-only
credentials cannot use updates or receipt replay to obtain existing fields.
`integration.items.read` remains limited to that connection's ingress items.

A household manager configures `GET/PATCH
/api/v1/households/:householdId/integrations/:connectionId/ha-sharing` using the
normal browser session, Origin and CSRF token. PATCH supplies the full policy
plus `expectedRevision` (0 for an unconfigured policy):

```json
{"expectedRevision":0,"listIds":["groceries"],"household":true,"personIds":[],"calendarSourceIds":[],"allowSharedNativeWrites":false}
```

The result is `{revision,listIds,household,personIds,calendarSourceIds,allowSharedNativeWrites}`. All
collections default empty and `household` defaults false. The additive
`allowSharedNativeWrites` flag defaults false, including when an older PATCH
client omits it. Only the normal household manager session/CSRF route may grant
it; HA bearer credentials cannot change their own sharing policy. Person/source IDs must
belong to this household. Source selection does not override current content
reader permissions. The current Samvev model has exactly one native household
shopping board, stable ID `groceries`; no invented named shopping-list database.
Selection of this list grants only grocery content. Household/person selection
grants messages/calendar addressed to those readers, never person subjects alone.
Imported sources additionally require explicit `calendarSourceIds` selection.

`GET /connection` authenticates and returns
`{schemaVersion:1,installationId,connectionId,householdId,name,timezone,capabilities,grants}`.
`grants` is the policy above including revision. Connection ID is the stable HA
unique identity. Missing read capabilities simply omit those content collections.

`GET /snapshot` returns the connection fields plus `serverNow` (UTC ISO instant),
`lists:[{id,name,writable,items:[{id,label,checked,revision}]}]`,
`messages:[{id,body,authorName,authorType,audience:{household,personIds},publishAt,expiresAt,importance,state,revision,readOnly}]`,
`calendars:[{id,name,writable}]`. Imported calendar descriptors additionally expose
`freshness` (`pending|current|stale`), `lastSyncSucceededAt`, `errorCode`, and
`lastCompleteWindow:{from,to}|null` independently of bridge polling success. Message arrays contain ALL currently active,
published and unexpired permitted messages, not a last-message projection.
`authorType` is `member`, `display` or `integration`; integration authors identify
the connection, never the dashboard user. Message lifecycle states remain
separate from display render/read/acknowledgement; HA creates no render receipts.
Native calendar ID is `samvev`; imported calendar IDs are source UUIDs and always
read-only. Collections omitted by grants are returned as empty arrays.

## Grocery writes

- `POST /lists/groceries/items`: `{label,checked,requestKey}` -> `{item}` (201).
- `PATCH /lists/groceries/items/:id`: `{label?,checked?,expectedRevision,requestKey}` -> `{item}`.
- `DELETE /lists/groceries/items/:id`: `{expectedRevision,requestKey}` -> `{item:{id,revision}}`.

Labels are 1–120 characters. The existing household-board service owns these
mutations, revisions, stable IDs, tombstones and idempotency. Supported fields are
label and checked only; no XP, rewards, parental approval, deadlines or description.

## Messages

- `POST /messages`: `{body,importance,audience,publishAt?,expiresAt,requestKey}` -> `{message}` (201).
- `PATCH /messages/:id`: `{body?,importance?,audience?,publishAt?,expiresAt?,expectedRevision,requestKey}` -> `{message}`.
- `POST /messages/:id/withdraw`: `{expectedRevision,requestKey}` -> `{message}`.

`body` is 1–1000 characters; importance `normal|attention`; audience is
`{household:boolean,personIds:[]}` with at least one target. Targets must be subsets
of connection grants. `publishAt` is an optional aware ISO instant (default now),
`expiresAt` a required later aware ISO instant. Without `allowSharedNativeWrites`, updates/withdrawals remain limited to
messages authored by this connection with no active display recipients. With the
explicit flag, readable native household messages may be edited/withdrawn when
the complete original and proposed household/person audience is still granted.
Existing display recipients may be retained only with `household:true` and active
same-household displays. A person-only policy does not grant display write access.
HA cannot add or replace display recipients. Successful edits preserve existing
recipient IDs and reset delivery/render state using the M1 message lifecycle.
Display rows are pinned against revocation, with expiry rechecked after lock waits
and immediately before commit, including withdrawals and receipt replay. Native browser-authored messages are readable when shared. They become writable
only with the explicit `allowSharedNativeWrites` policy and the paired message
read/write capabilities, subject to the complete current and proposed audience.
The original member/display/integration author is preserved. Each edit/withdrawal
is recorded with the editing HA connection as lifecycle/audit actor. Worker/system
creation provenance (including monitor-produced notices attributed to a member)
remains read-only; the author name alone is not proof of native user authorship. Returned messages have the snapshot shape;
withdrawn/cancelled messages disappear from the next snapshot.

## Calendar

`GET /calendars/:calendarId/events?start=<aware ISO instant>&end=<aware ISO instant>`
returns `{events:[{id,summary,start,end,description,location,revision,readOnly,source}],serverNow}`.
Imported reads outside their last complete source synchronization window fail with
409 `ha_calendar_window_not_synced`; extend/resync the source in Samvev instead of
interpreting an unfetched range as empty.
The range is start-inclusive/end-exclusive, maximum 366 days; all overlapping
permitted events are returned, including simultaneous events. Empty results are
successful complete reads only; failures never mean deletion. Imported source
occurrences are already expanded by Samvev's existing calendar synchronization,
which handles recurrence overrides, cancellation and source limitations. `source`
is `samvev` for native events and provider name for imported ones.

`start`/`end` are both ISO dates `YYYY-MM-DD` for all-day events (exclusive end), or
both aware ISO datetimes for timed events. Civil dates must not shift through UTC.
Events have stable UUID `id` and positive integer `revision`.

- `POST /calendars/samvev/events`: `{summary,start,end,description?,location?,requestKey}` -> `{event}` (201).
- `PATCH /calendars/samvev/events/:id`: `{summary?,start?,end?,description?,location?,expectedRevision,requestKey}` -> `{event}`.
- `DELETE /calendars/samvev/events/:id`: `{expectedRevision,requestKey}` -> `{event:{id,revision}}`.

Native events reuse connection-owned `integration_items` and the existing Samvev
home projection. Their server-selected audience is the explicit connection grant.
By default only this connection's native events are writable. The explicit
`allowSharedNativeWrites` policy also permits native events authored by another
active HA connection in the same household, when the full original audience is
within current grants. Stable event/source IDs and original provenance remain
unchanged; the editing connection is recorded in audit. A native event must have server-owned `ha_native_origin:true` and carry
`metadata.haBridge:true`, have no `metadata.calendar` key and have no
`calendar_occurrences` relation. Producer JSON alone is not origin authority.
Migration 048 backfills origin only from the original connection’s persisted HA
creation receipt (matching household/event ID, revision 1 and native result shape);
subsequent HA creates set the column using a server-controlled SQL literal. A forged native marker never overrides either
provider indicator. Generic external-intelligence producers remain read-only. Imported Google/Microsoft/Spond/HA
calendars reject all writes. Native recurring creation is unsupported; HA must not
advertise recurrence features. A connection with calendar.write but no calendar.read
cannot expose a readable calendar entity.

## Concurrency, retry and update timing

Every mutation requires `requestKey`, 8–128 characters, stable for retries. The
server stores a durable operation receipt scoped to connection and key; identical
payload retries replay the result even with the original revision. Reusing a key
with different operation/content returns 409. Material edits/deletes require the
last observed revision; conflicts must be refetched and surfaced without silently
reapplying over the winner. Only authoritative successful responses confirm writes.

HA initiates all HTTP connections. Polling interval is 30 seconds, with an immediate
refresh after acknowledged mutations. This is an expected scheduling interval,
not measured real-time latency. Revocation is enforced on every request and again
inside mutation transactions. Authentication/authorization failure must clear HA's
protected current data; transient network failure retains last safe content marked
unavailable/stale. No HA callback exposure, HA public endpoint or extra server is
required. Samvev-native HA calendars must be excluded from Samvev's HA calendar
import to prevent a feedback loop.

HA machine authentication has a separate bounded budget of 300 requests per IP
per minute, with the existing bridge limit of 240 per connection per minute.
This accommodates the supported maximum of 50 imported calendars plus the native
calendar and snapshot at 30-second polling (104 requests/minute). Legacy ingress
routes retain their existing 90/IP/minute budget. Unknown well-formed bearer tokens
retain the shared 20-invalid-attempts/IP/minute limit; missing or malformed HA
bearer headers also consume the original shared 90/IP/minute abuse budget.


## Native content boundary after migration 048

`readOnly` on message and event rows is computed from the same source-type,
capability, state and complete-audience rules enforced on mutation. Having one
readable target is sufficient to read content; it is not sufficient to edit content
that also targets unshared readers. Durable receipt replay rechecks the current
policy, server-owned origin, source type and all original/current targets, including
withdrawn native rows used as retry witnesses. Calendar mutation results retain
the original `audience` for receipt authorization; interval read projections do
not add target identifiers. Pre-048 own-author receipt semantics are retained; a
shared-author replay requires the original audience witness. Turning the shared-native flag off stops further
cross-author changes and replay immediately; it does not rewrite any author.

At development baseline `09bbd73`, the Samvev web UI has full native message
create/edit/withdraw support. Its calendar UI configures/imports providers and
shows appointments; it has no local appointment create/edit form or corresponding
member CRUD API. Therefore no UI-created local-calendar roundtrip is claimed or
fabricated. This targeted change supports the existing connection-authored native
appointments, including sharing them across expressly authorized HA connections.
Imported Google/Outlook/ICS/Spond/HA appointments remain read-only. No new calendar
UI, event database, provider write-back or AI engine is introduced.

Migration 048 adds a non-null false-default sharing policy column and a
server-owned native-origin column on integration_items, with receipt-provenance
backfill for previously created native HA appointments. Existing connections
retain their previous write boundaries until a household manager explicitly enables
it. Disabling the flag is the narrow policy rollback; no destructive database
rollback or automatic restoration over newer writes is required.
