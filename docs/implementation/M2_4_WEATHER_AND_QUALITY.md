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

After the user reviews a fixed weather place and period, the server pins that
scope. It ignores model paraphrases of place or time and sends only reviewed
values upstream. Fixed weather-only tasks execute the registered tool once
before the provider turn and pass its bounded verified result to the model.
Completed tools are removed from the provider tool list and identical
successful calls are deduplicated. For a combined batch, an approved `web.open`
call can establish the exact date needed by a declared weather call; the latter
is re-authorized only after the evidence exists.

MET points produce a deterministic evidence summary. A single-source weather
fallback presents it as localized user copy while keeping the exact summary as
source evidence. Valid evidence-backed focused answers remain intact; only raw
machine-summary copies are presentation-normalized. A combined conditional fallback is narrower: it can evaluate
only an explicit rain/precipitation or temperature threshold for a date present
in both verified sources. It creates a validated event when true and no event
when false. Other conditions fail closed. A one-turn same-tier format repair can
reuse verified evidence without fetching or changing the saved quality
preference. If combined setup formatting still fails after both tools succeed,
the preview uses a minimal editable rule containing only the original
instruction, schedule and approved tool plan; no model-produced fact is
accepted by that fallback.

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

The actual configured local OpenAI-compatible provider was exercised in
isolated QA on 2026-09-12 without recording its endpoint, model name or
credentials. The exact query `Sjekk været på Birkeland i morgen` produced five
plausible Kartverket matches and correctly required clarification. After the
supported clarification to `Birkeland, Birkenes`, setup used one routine turn in
**82.7 s** and Test now used one routine turn in **73.2 s**. Location resolution
took **234 ms** and MET took **44 ms**. The draft remained inactive and created
no message. The wording `via yr` used the same weather tool, never opened Yr,
and completed setup and Test now in **88.1 s** and **76.2 s**, one routine turn
per phase.

The synthetic non-personal combined schedule-and-weather pilot selected the
stronger internal tier for `multi_tool`. Each phase opened the fixture and
called weather once, retained both provenance entries and used no automatic
escalation. A verified relevant condition created one message; the normal case
returned no event and created no message. Setup and execution together took
**247.8 s** for the relevant case (longest provider turn **83.5 s**) and **212.8
s** for the normal case. Each independent phase stayed below the unchanged
180-second deadline. Location and weather calls were below **143 ms** and **47
ms** respectively; model inference dominated. Instrumented transports confirmed
that only place and forecast time reached Kartverket/MET, never fixture plan
text or person data.

The mocked full database integration still covers interpretation, approval, a
relevant notification, a changed dry forecast and withdrawal. No paid AI call
was made, and the global 180-second deadline remains unchanged.

The post-pilot candidate passed all **128** workspace tests: web 15, contracts
3, core 3 and API 107. All five workspace typechecks and the production build
passed. A fresh isolated database applied migrations 001–013 twice; ledger and
file checksum for migration 013 both equal
`72c615d27b7349313e7ede7bc179f8190182264c28ba594688aabb98b81ddd5f`.
The focused browser smoke passed NB/EN, keyboard/focus, Axe, mobile, desktop,
1280×752 wall-panel and dark mode with zero real browser requests and no new
screenshots. Compose validation, isolated QA health, whitespace and
secret/private-data scans passed.
