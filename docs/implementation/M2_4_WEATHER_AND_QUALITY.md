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
was made.

## Daily conditional weather correction candidate

Synthetic live reproduction on the deployed `e1cce66…` runtime confirmed a
later owner-reported Lillesand failure as deterministic: three independent
setups failed in 61–70 ms with zero provider turns, one failed weather tool call
and no provenance. The parser had passed the complete schedule and condition
tail as the place query. The qualified form reached Kartverket but the resolver
gave equal rank to several different Lillesand records in Agder. This was not a
MET outage or a model failure.

The correction follows ADR 0019. It stores an optional daily 08:00
Europe/Oslo schedule and a typed rain OR maximum-wind condition in the existing
rule JSON. All scheduled terminal paths calculate the next local wall-clock
occurrence through the same DST-aware helper. Weather-only conditional runs
evaluate verified MET data server-side and return a valid empty event list when
neither condition is met. The UI previews the exact schedule, strict threshold,
period and no-notification case in NB/EN and separates place-service failures
from forecast-service failures.

No migration is added. Existing rules retain interval behavior and are not
reinterpreted. The permanent live-E2E matrix adds simple Lillesand 3× and daily
conditional Lillesand 3×. The correction is not deployed; its live matrix needs
a new explicit deploy gate.

The current-tree gate passes all **170/170** workspace tests (including **146/146** API tests), all workspace
typechecks and the production build. Focused weather/domain/E2E-helper tests
pass **66/66**, database weather/durable-execution integration passes **16/16**,
and the shared browser smoke passes NB/EN, Axe, keyboard/focus, mobile/desktop,
dark/light and reduced-motion checks with only intercepted synthetic traffic.
A fresh synthetic database applied migrations 001–016 twice and retained an
exact 16-entry ledger. Isolated app, worker and database health, diff validation
and the private-data/secret scan pass. This is local candidate evidence only:
the post-fix Lillesand 3× matrix remains blocked until a separately authorized
immutable deployment.

The post-pilot candidate passed all **128** workspace tests: web 15, contracts
3, core 3 and API 107. All five workspace typechecks and the production build
passed. A fresh isolated database applied migrations 001–013 twice; ledger and
file checksum for migration 013 both equal
`72c615d27b7349313e7ede7bc179f8190182264c28ba594688aabb98b81ddd5f`.
The focused browser smoke passed NB/EN, keyboard/focus, Axe, mobile, desktop,
1280×752 wall-panel and dark mode with zero real browser requests and no new
screenshots. Compose validation, isolated QA health, whitespace and
secret/private-data scans passed.

## Owner pilot blocker and durable execution follow-up

The live owner pilot on 2026-09-13 passed the plain weather request. The
`via yr` variant timed out once and then passed on retry. The combined week-plan
and weather task failed three times at the former 180-second server deadline.
That is a release blocker for PR #9 and Issues #7/#8, tracked separately in
Issue #10. M2.4 is not accepted or merge-ready on this evidence.

The follow-up replaces synchronous monitor actions with the persistent
execution model in ADR 0017. Setup interpretation, Test now, Run now,
smarter-quality previews and scheduled runs enqueue a stable execution and are
processed by the worker. Local simple work has a bounded five-minute maximum;
local multi-tool, schedule-like or stronger-quality work has a bounded
ten-minute maximum. Hosted work retains the three-minute maximum. Leases add a
60-second completion margin.

Migration `014_monitor_durable_executions.sql` is additive. It introduces the
queue, sanitized progress/timing fields, single-flight index and execution
links for run/tool/quality audit. The task projection restores the active run
and latest current-revision preview after reload. Browser transport failures no
longer become AI timeouts.

The release evidence below describes the previous M2.4 candidate. A new full
release gate and isolated local-provider pilot are required for the durable
execution candidate before deployment.

The durable candidate's focused and full synthetic validation now passes. The
production HTTP contract returns `202` for interpretation, Test now, Run now
and smarter previews and exposes the stable execution through an authenticated,
household-scoped read endpoint. The worker rechecks requester authority and the
AI settings revision, isolates a misconfigured scheduled task from the rest of
the queue, and fairly claims work across households. If a worker stops after a
domain result committed but before queue finalization, lease recovery reconciles
the matching task/revision/kind run or interpretation audit and restores its
server-anchored public provenance rather than misreporting an interruption.

The current migration 014 checksum is
`027ca591ee806b468b0efbb33776402b733e8f4db44386fddda17b2cad4b0eea`
and matches fresh and repeated isolated test/QA ledgers. Full workspace tests
pass **141/141**: web 16, contracts 3, core 3
and API 119. All workspace typechecks and the production build pass. The
focused durable suite passes **12/12**, including stable IDs, duplicate starts,
a fake-clock four-minute provider result through the real interpretation
service and agent runner, true server timeout, scheduled execution,
configuration-failure isolation, interrupted-worker recovery, crash-window
reconciliation and escalation telemetry on failed runs. Deterministic
dependency refreshes contribute their actual web, location and weather timings
even when no AI call is needed. Focused NB/EN browser smoke passes keyboard,
focus, Axe, mobile, desktop and 1280×752 checks with zero real requests; two
synthetic progress screenshots were inspected for the new running state. The broader M1
browser scenario still stops at its pre-existing display-pairing response wait;
no monitor assertion fails, and this unrelated smoke issue is not hidden as a
pass. No local-provider pilot or live deploy has been run for this candidate.

## Post-deploy combined-source correction candidate

The first live M2.5 owner run exposed a separate setup defect for a task that
combined an explicit week-plan URL with weather for tomorrow. Both attempts
opened the approved web source successfully, but made no weather request. The
setup code had classified every `web.open` plus `weather.forecast` task as if
its forecast date had to be discovered from web evidence, even when the
instruction already said `tomorrow`. The model could therefore finish after
`web.open`; the required-tool guard correctly rejected that incomplete result
as `AI_RESPONSE_INVALID` before combined provenance was created.

The correction keeps explicit `today`, `tomorrow` and calendar dates as fixed,
reviewed weather scope. Samvev resolves and fetches that approved forecast
server-side before asking the model to perform the remaining web work. A date
is dynamic only when it really must come from the opened source. The model
still decides whether the verified plan and forecast merit an event. A
successful `events: []` is accepted only when complete, date-aligned web and
weather evidence exists, so an unavailable or truncated source cannot become a
false all-clear.

For a positive combined result, source quotes and atomic claims remain verbatim
and are anchored to both tool results. Samvev renders the user-facing frame in
the task locale from those validated facts, rather than requiring translated
presentation text to occur verbatim in an English weather payload. Setup and
execution prompts also state the resolved `nb` or `en` output language. The
normal Oppdrag UI now presents a successful empty result as no condition
requiring a notification for the checked period.

The durable progress panel retains its server-reported stages and adds a
decorative activity spinner and running accent. It shows no percentage,
disappears on terminal state and is static under `prefers-reduced-motion`.

This is an application-only correction on top of migration 014. It adds no
migration and does not change the durable HTTP 202, timeout, lease,
single-flight or stale-revision contracts. It remains undeployed pending a new
candidate gate and owner pilot.

The final local gate passed with 144/144 workspace tests and 82/82 focused
monitor, weather and durable-execution tests. Workspace typechecks, the
production build, synthetic browser smoke (including Axe, focus, responsive
layouts and reduced motion), fresh migrations 001-014 applied twice, isolated
Compose health, diff validation and the private-data/secret scan also passed.
The current correction is not deployed; a committed candidate, CI and a new
controlled deploy plus owner pilot are still required.
