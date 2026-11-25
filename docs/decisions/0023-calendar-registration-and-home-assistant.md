# ADR 0023: Installation calendar registration and optional HA Spond snapshots

Date: 2026-10-14. Status: Accepted for the authorized calendar GUI test candidate.
Extends ADR 0022; replaces its primary Spond cloud-calendar bridge with optional
HA-native Spond import. The cloud-calendar bridge remains an explicit alternative.

Use the existing CalendarService, vault, calendar source/occurrence tables,
worker leases, snapshots and projections. No parallel integration architecture.
Installation.manage gates installation registrations; ordinary adult account
owners may manage only private self-scoped sources. Current household authority
is required for other subjects/readers/displays. Children/display tokens cannot
manage connections. OAuth and configuration writes recheck active authority.

Migration025 is additive. One installation/provider encrypted configuration row
is authoritative when present, including disabled state. Only absent rows reuse
legacy environment registration. App and worker resolve the same source; changes
fence pending consent and sync generations. Same-client secret rotation preserves
refresh tokens; changed client identity requires consent. Secrets are not echoed.

HA uses documented browser authorization, session-bound single-use state and
CSRF-protected completion, not invented PKCE. Only administrator-approved exact
origin, pinned requests, read-only registry/calendar paths and bounded HTTP/WS
responses. HA user token rights are broader than Samvev selected-entity filtering.
Spond credentials remain in HA. No HA installation/automation/proxy changes.

Discover spond_tracker registry calendars and fetch the full requested bounded
calendar snapshot, never the truncated next-event sensor. Require actual UIDs;
use recurrence ID when available and stable single identity otherwise. Discard
descriptions/participant lists. Preserve explicit structured statuses; absent
status remains unknown. Upstream cache/status/name-grouping limitations remain
visible; no guaranteed full horizon, fuzzy matching or cloud/HA title-time merge.

## Recovery

Keep all earlier migration checksums, data, photos, tasks and approved schedules.
Before old-image rollback stop the worker, fence new HA rows and callbacks with
migration025's exact SQL, then verify old worker cannot claim them. Old code also
cannot resolve DB-managed registrations or safely refresh adult-private sources;
GUI-configured/private sync needs forward recovery or an explicitly prepared
compatible configuration. Do not restore an old database automatically over new
writes. Retain encrypted rows/mappings for forward recovery and test compatibility
against an isolated restore. Configuration restore requires the existing vault.

Real external registration/consent/HA instance access are separate acceptance
receipts; synthetic tests do not imply live verification. Public test deployment
requires the established source/build/capacity/backup/restore/rollback gates.
