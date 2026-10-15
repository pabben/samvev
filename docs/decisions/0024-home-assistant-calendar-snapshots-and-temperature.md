# ADR 0024: General Home Assistant calendar snapshots and temperatures

Date: 2026-10-15. Status: Accepted for the authorized test candidate.
Extends ADR 0023 without replacing the existing calendar connection, encrypted
credential, source mapping, access-control or worker architecture.

Home Assistant discovery includes every calendar exposed by `/api/calendars`.
Registry IDs are retained exactly when available and resolved to the current
entity ID at read time. A registry-missing entity uses a namespaced entity ID and
is presented with the limitation that renames are not stable. Spond provenance
is asserted only from a matching `spond_tracker` registry row. Existing raw
Spond registry identities and mappings are not rewritten.

Provider event UIDs and locally derived snapshot identities are separate
identity domains. A UID-less HA event receives an exact canonical content digest
plus its duplicate ordinal in that snapshot. There is no fuzzy title/time match
or transfer of metadata between identity domains. Exact duplicate events remain
distinct. A successful complete snapshot reconciles missing occurrences only
when they overlap its validated time window. Items outside the window and the
last good projection after an incomplete or failed fetch remain intact. A
targeted state read must report the selected calendar entity available before a
cached HTTP 200 response can be accepted as a complete snapshot.

Each selected HA calendar is a separate completeness boundary. A source-local
health, response-shape or fetch failure marks only that source stale, retains its
last successful window and projection, and does not prevent another complete
source snapshot from reconciling in the same fenced transaction. Authentication,
provider configuration, authority, global response-budget and supersession
failures still abort the whole attempt. The connection reports a partial error
until all enabled sources complete; source-level success times and errors remain
the authority for item freshness. Worker startup only advances an already
scheduled, connected and authorized HA connection. It never resumes paused,
disconnected, revoked, configuration-error or unscheduled connections.

Calendar purpose (`calendar` or `waste`), label, time window, subjects, readers
and displays are explicit source settings. Re-discovery updates names and current
entity bindings, adds new sources inactive and marks missing sources unavailable;
it does not delete choices or rights.

Temperature discovery reads bounded, searchable entity-registry metadata. Since
that registry may omit device class and unit, a selected candidate stays inactive
until a targeted state read confirms temperature type, finite value and Celsius
or Fahrenheit. Samvev never fetches the global state list. Each enabled sensor
has an independent lease, due time and failure backoff and projects one
observation. Source-reported and source-updated timestamps remain separate from
fetch time; missing, invalid and failed readings retain the last valid value with
an explicit stale/error state. Sensor readers, display targets and order are
independent of calendar source mappings.

Enabling a validated sensor immediately creates a nullable, stale observation so
the UI can say that no reading exists without inventing zero. Reader, display,
title and order changes update that projection atomically, including revocation,
without waiting for a successful poll. A returned state must identify the exact
selected entity. Validation is invalidated when its entity or provider origin
changes, and a post-I/O fence rejects results after connection generation,
configuration, session, integration or owner-authority changes.

Credential refresh is serialized across preview, discovery and sensor reads.
Connection generation, provider configuration revision, owner authority and
integration revocation fence writes. Disconnect, provider revocation and lost
owner authority stop polling and withdraw or stale the corresponding projection.

## Recovery

Migration 026 is additive except for replacing the calendar-occurrence unique
constraint with the same key plus identity domain. Existing rows default to
`provider`; their provider-derived external IDs remain unchanged. Before rolling
back to code older than migration 026, stop the worker, disable all temperature
sensors, clear their due/lease fields and withdraw active temperature observation
items. The added tables and columns may remain for forward recovery. Preserve the
vault and calendar connection rows. Do not restore an older database over newer
writes automatically.

Synthetic protocol and integration tests do not constitute live verification of
a household HA instance. Actual source availability, event completeness and
sensor values require separately authorized observation.
