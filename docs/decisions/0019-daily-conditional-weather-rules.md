# ADR 0019: Daily conditional weather rules use server-owned scheduling and evaluation

Status: **Accepted for implementation; live verification pending**

## Context

A live request to check Lillesand every day at 08:00 and notify on rain or wind
above 10 m/s failed before model inference. The location parser sent the
schedule and condition tail to Kartverket. The existing `1440` minute interval
also drifted from a reviewed local wall-clock time and did not represent DST.
The condition itself was left to free-form model output.

## Decision

Reviewed monitor rules may carry two optional typed fields in the existing
versioned JSON rule:

- `schedule: { kind: "daily", localTime, timezone: "Europe/Oslo" }`
- `weatherCondition` with an explicit `or` of rain and/or strict
  `max_wind_speed > thresholdMps`

The server extracts and anchors those fields from supported natural language.
The model cannot choose coordinates, recurrence, time zone or threshold
semantics. Existing rules without these fields keep interval scheduling.

Daily next-check calculation uses PostgreSQL time-zone conversion and the next
local wall-clock occurrence, so 08:00 remains 08:00 through both DST changes.
Approval, resume, scheduled success, unchanged and failure paths use the same
helper. A newly approved daily rule therefore waits for its reviewed wall-clock
time instead of running immediately. Manual and Test-now runs preserve the
stored schedule.

For the typed weather-only condition, Samvev evaluates verified MET data
without another AI turn. “Wind” means the maximum available MET `wind_speed`
sample for the selected period: a 10-minute mean at 10 metres, not gusts. The
comparison is strict, so exactly 10.0 m/s does not satisfy `> 10`. “Rain” needs
positive precipitation in a forecast interval whose symbol identifies rain;
snow is not treated as rain. A false OR result is a valid `events: []` and
creates no message.

Forecast points are filtered by the Europe/Oslo calendar date without a
24-point cap. One-hour precipitation intervals are preferred. When only
six-hour periods exist, overlapping periods are counted once. Incomplete data
fails closed instead of becoming an all-clear. Completeness is measured against
the expected hourly instants for the selected Oslo date and time window, not
against the number of returned records. This yields 23 or 25 expected hours on
DST transition days; for `today`, only the current or next whole hour through
the end of the selected window is required. Missing interior or final hours are
still incomplete.

Place resolution prefers an exact place whose municipality has the same name,
while genuinely tied places remain ambiguous. Upstream errors retain only an
allowlisted `location` or `forecast` stage for user-facing classification;
queries, coordinates and raw payloads remain private.

## Consequences

No migration is needed because the fields are optional in the existing rule
JSON. Rollback is code-only; older code ignores no newly written database
columns. Existing approved tasks are not reinterpreted automatically. The
permanent synthetic live-E2E matrix adds simple Lillesand and daily conditional
Lillesand runs, but deployment and live PASS require a separate owner gate.
