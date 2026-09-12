# ADR 0016: Official weather tool and deterministic quality routing

- Status: Accepted
- Date: 2026-09-12

## Decision

Samvev extends the provider-independent monitor tool registry from ADR 0015 with
`weather.forecast`. The tool accepts a place, period and optional time window.
The registry owns each tool's provider schema and authorization policy. The
runner owns the stateful execution adapters and emits one common dependency,
provenance and attempt record after a registered call is authorized; this keeps
network clients out of provider contracts while avoiding per-provider dispatch.
It resolves Norwegian place names through Kartverket Stedsnavn and fetches the
compact Locationforecast 2.0 response directly from MET Norway. Both upstream
endpoints are fixed HTTPS endpoints owned by server code. The model cannot
select another weather service, method, header or URL. Wording such as “via Yr”
is treated as weather intent; Samvev does not scrape Yr and does not attribute
MET data to Yr.

Place resolution is deterministic. Exact normalized place names rank first and
municipality or region terms disambiguate equal names. An unresolved tie fails
with a bounded list containing only place, municipality and region. Coordinates
are retained to four decimals only inside the weather client. They are not put
in provider prompts, ordinary API DTOs, public source links, audit provenance or
durable dependency manifests. Only the place query is sent to Kartverket;
household, account, person, task and schedule data are never sent to either
source. A task without a place fails for clarification rather than inheriting or
guessing a household location.

MET requests identify Samvev with `SAMVEV_WEATHER_USER_AGENT`, falling back to a
safe open-source project identifier. They request gzip, enforce JSON MIME and a
2 MiB response bound, and share the monitor's outer cancellation deadline.
Raw validated responses are cached by rounded coordinate pair within each app
or worker process, with a 256-location process bound, so different dates and dayparts reuse one upstream forecast.
Concurrent identical requests in that process are deduplicated. A process restart intentionally
starts with a cold cache. Durable dependency fingerprints stay in PostgreSQL,
so restart-safe change detection still skips AI when refreshed sources are
unchanged, without persisting third-party forecast payloads.
`Expires` and `Last-Modified` are retained; expired cached requests use
`If-Modified-Since`, and a `304` reuses the validated payload. `200` and `203`
are accepted and recorded. `403`, `429`, invalid schema, timeout and other
upstream failures retain distinct normalized error paths. Every successful
result attributes “MET Norway Locationforecast” and stores retrieval and
validity timestamps.

After approval, weather arguments are bound to the reviewed place, period and
daypart. A combined task may select only an exact calendar date found in a
successfully opened web document. The registry validates a complete provider
tool-call batch before any network request, and invalid or out-of-scope calls
fail closed within the existing bounded loop.

Monitor source URL is nullable. A weather-only task has no fabricated web URL;
its approved `tool_plan` contains `weather.forecast`. A mixed source task may
contain both `web.open` and `weather.forecast`. Dependencies and provenance are
typed by tool. Composite events carry server-anchored evidence entries for each
source. Atomic claims must occur in exact bounded quotes, dated web evidence
must contain the event date, and weather evidence must cover that same date.
The model never supplies audit identifiers. Fabricated or unopened URLs and
unsupported claims fail closed. A verified false condition returns an empty
event list, so the existing message reconciler creates no notification.

Quality selection is deterministic and server-side. A saved strong preference
always wins. Multi-tool tasks, person-specific schedules, conditional
notifications such as rain or freezing-point alerts, and explicit NB/EN
week-plan or schedule semantics start on the strong tier for both setup
interpretation and execution; a simple single-source extraction or forecast starts on routine. Prompt
length, provider identity and model name do not influence routing. Provider,
model, tier and routing internals remain absent from ordinary Oppdrag DTOs.

A routine setup or execution run may escalate once to the strong tier only after invalid structured
output, failed multi-source composition, or explicitly reported,
server-validated confidence below `0.55`.
Missing confidence remains distinct and does not trigger escalation. Source,
permission, SSRF, location ambiguity, configuration and timeout errors never
escalate. The second attempt stays with the configured provider and receives only
the remaining portion of the existing seven-turn, six-tool and 180-second
budgets, and it does not start unless at least 30 seconds remain. No automatic
paid-provider fallback is introduced. Compact routing
audits contain phase, reason, from/to tier and outcome, without prompt, output,
provider, model or source content.

Automatic routing remains invisible in the ordinary task view. When a user
explicitly saves “smarter AI for this task”, the task card shows only that
plain-language preference and offers the existing standard-quality choice; it
still exposes no tier, model, provider or reasoning setting.

## Migration and rollback

Migration `013_monitor_typed_tools_and_quality.sql` drops only the `NOT NULL`
constraint from `monitor_tasks.source_url`, adds the constrained `tool_plan`,
adds a constrained sanitized `monitor_runs.error_details` field, and creates
`monitor_quality_audits`. Existing tasks are backfilled by the
column default with `web.open`; no existing row or source URL is changed.

Before a code rollback, pause every weather task and every task whose source URL
is null; an older runtime cannot execute those tasks even though it can coexist
with the additive columns and audit table. A full schema rollback must also
remove or replace rows whose source URL is null, then restore `source_url NOT
NULL`, drop the quality audit table, drop `monitor_runs.error_details`, and drop
`tool_plan`.

## References

- MET Norway API terms: https://docs.api.met.no/doc/TermsOfService.html
- Locationforecast usage guide: https://docs.api.met.no/doc/locationforecast/HowTO.html
- MET Norway attribution/license: https://docs.api.met.no/doc/License.html
- Kartverket Stedsnavn API guide: https://www.kartverket.no/api-og-data/stedsnavndata/brukarrettleiing-stadnamn-api
- Kartverket terms: https://www.kartverket.no/api-og-data/vilkar-for-bruk
