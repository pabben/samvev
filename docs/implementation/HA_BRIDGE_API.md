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
{"expectedRevision":0,"listIds":["groceries"],"household":true,"personIds":[],"calendarSourceIds":[]}
```

The result is `{revision,listIds,household,personIds,calendarSourceIds}`. All
collections default empty and `household` defaults false. Person/source IDs must
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
`messages:[{id,body,authorName,authorType,audience:{household,personIds},publishAt,expiresAt,importance,state,revision}]`,
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
`expiresAt` a required later aware ISO instant. Updates/withdrawals are limited to
messages authored by this connection whose complete current audience is still
granted. If a Samvev administrator adds display recipients, HA can no longer edit
or withdraw that message because this adapter has no display-recipient grant. Native browser-authored messages are readable
when shared but cannot be edited by HA. Returned messages have the snapshot shape;
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
Only this connection's events are writable. Imported Google/Microsoft/Spond/HA
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
