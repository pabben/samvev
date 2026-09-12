# M2 weather tool and quality routing

The backend now has a typed `MonitorToolRegistry` with `web.open` and
`weather.forecast`. Provider adapters still receive the common `AiToolDefinition`
contract, while the monitor runner validates each call against its registered
Zod arguments and tool permission before execution.

`weather.forecast` resolves a place with Kartverket and obtains compact official
forecast data from MET Norway. The bounded model payload contains canonical
place data, forecast points, attribution, retrieval/validity times and an exact
evidence text. Stored provenance excludes the full payload and retains source,
fingerprint, timestamps, response metadata and minimized place metadata.
Public source DTOs expose source kind, a safe label, attribution, canonical
place and forecast validity/update timestamps. The actual fixed MET request URL
is replaced with a coordinate-free MET documentation link outside the client.
Coordinates never enter AI-provider input, task DTOs, provenance or dependency
manifests.

Weather-only tasks store `source_url = NULL` and
`tool_plan = ["weather.forecast"]`. Mixed web and weather tasks store both
tools. Migration 013 preserves every existing task as a `web.open` task.
Before rolling application code back to a pre-M2.4 runtime, operators must pause
weather tasks and any task with a null source URL. The migration columns may
remain during that code rollback; schema rollback has the stricter cleanup
sequence documented in ADR 0016.

The quality router selects strong during setup interpretation and execution for approved multi-tool, person schedule or
explicit NB/EN week-plan/schedule rules, conditional notifications such as rain
or freezing-point alerts, and honors a saved strong preference. Routine output can make one bounded
retry on strong for invalid schema, failed multi-source composition or
explicitly low confidence. All tool calls and provider turns from both attempts
count against the original limits and 180-second deadline; escalation requires
at least 30 seconds remaining, and a provider change during the run fails
closed. Setup interpretation has the same one-escalation bound for invalid
structured setup output. Automatic selection never changes the task's saved user preference.
The ordinary task card therefore stays unchanged after automatic routing, while
an explicitly saved smarter preference is shown in plain language without any
model, provider, tier or reasoning detail.

The cache is deliberately process-local. Raw forecasts are keyed by rounded
coordinates, then date/daypart filtering is done locally. Identical requests are deduplicated
and honor `Expires`/`Last-Modified` while a process is running. The cache holds at
most 256 coordinate entries. A restart begins
with a cold upstream request, then compares its fingerprint with the durable
dependency manifest in PostgreSQL before deciding whether AI analysis is needed.

Event evidence can contain multiple typed, server-anchored source entries. A
web schedule date and the weather validity date must agree, every declared
claim must occur in the bounded quote the model received, and supplied URLs must
match successful tool history. A false condition is represented as an empty
event list and therefore creates no message.

Focused fixtures cover place ambiguity, deterministic municipality selection,
Oslo calendar boundaries, coordinate rounding, cache reuse and revalidation,
`200`/`203`/`304` handling, bounded `429` metadata, timeout/MIME/streaming-size
failures, typed weather provenance, approved argument scope, routing and missing
versus explicit confidence. The combined fixture opens a schedule first, asks
for weather only for its exact date, creates a relevant rain notification and
withdraws it when the forecast no longer matches. No external API or paid
provider is used by automated tests.

The optional `SAMVEV_WEATHER_USER_AGENT` must be a printable identifying product
token with `/` and should include an operator contact URL or email. Samvev sends
gzip-capable conditional requests, accepts MET `200` and `203`, reuses a valid
cached body on `304`, fails distinctly on `403` and `429`, and never follows
provider redirects.

## Verification snapshot

The final read-only provider pilot on 2026-09-12 resolved a synthetic public query for
`Birkeland, Birkenes` and fetched tomorrow morning's forecast in **259.8 ms**
total: Kartverket **140.0 ms**, MET **44.6 ms**, with six bounded forecast
points. The request returned HTTP 200 from both services. This pilot used the
real weather client and no Samvev production data or AI provider.

The synthetic combined schedule-and-rain integration uses three provider turns
and two tool calls (`web.open`, followed by `weather.forecast`) for analysis.
The full database integration test, including interpretation, approval, a
relevant notification, a changed dry forecast and withdrawal, completes in
about 0.2 seconds with mocked providers. Real model inference is deliberately
not claimed by this local gate; no external or paid AI call was made, and the
global 180-second deadline remains unchanged.

The final workspace run passed all **124** unit and integration tests. It
includes migrations through 013, scheduled invalid-schema escalation, a
conditional freezing alert, cache concurrency, Issue #4/#5 monitor regressions,
provider behavior, authentication and household isolation. All five workspace
typechecks and the production build passed. The focused browser smoke passed in
NB and EN at mobile, desktop and 1280×752 wall-panel widths with keyboard,
focus and Axe checks, two synthetic screenshots, and zero unmocked browser
requests.
