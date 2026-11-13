# ADR 0026: Native Home Assistant adapter uses explicit export sharing

- Status: Accepted for implementation, pending review
- Date: 2026-11-12

## Context

The optional native HA custom integration needs standard shopping to-do and
calendar entities plus multiple concurrent messages. Existing integration tokens
only read/write their own external-intelligence items; expanding that capability
into a household read grant would expose private data implicitly. Existing HA
calendar/Spond imports, temperature polling and restricted physical controls are
independent and remain server-owned adapters. Embedding `/display` (PR #25) does
not provide native HA entities and is outside this change.

## Decision

Extend the existing household-scoped, revocable hashed credential with six
`ha.<area>.<read|write>` capabilities. Add a separate default-deny per-connection
export policy, configured by the existing household manager session/CSRF API.
The policy explicitly selects the current native grocery board, household and/or
person reader audiences and individual imported calendar sources. Subject/person
placement never substitutes for reader permission. Current imported-source owner
and connection authority are rechecked on export.

Use `/api/v1/ha` for a versioned authenticated handshake, authoritative snapshots
and bounded mutations. Reuse HouseholdBoardService, existing messages and their
lifecycle records, and existing integration_items for connection-authored native
events. Add integration as a distinct persisted actor rather than impersonating a
member or display. The current grocery model has one household board; the adapter
does not create a parallel list/task database. Imported calendars remain read-only;
native events are writable by their authoring connection unless a manager
explicitly enables the migration-048 shared-native write policy described below. Existing imported
recurrence/cancellation expansion is reused. Native recurring creation is absent
and must not be advertised as supported.

CAS revisions prevent lost updates. Durable per-connection mutation receipts
prevent duplicate retries; receipt replay is itself authorized against current
sharing. Writes and reads pin credential/connection/sharing authority inside
transactions. Imported calendar reads outside the last complete synchronized
range fail explicitly rather than implying absence. Source freshness remains
separate from adapter connectivity.

HA initiates requests; a 30-second poll plus authoritative refetch after writes
provides recovery without a callback, separate server or HA public exposure.
No measured real-time claim is made. The HA adapter clears protected current
content on authorization loss and reports transient disconnection as unavailable.
Samvev's HA import rejects entity-registry platform `samvev` in discovery and at
fetch time, including the legacy entity-ID fallback, to prevent a roundtrip loop.

## Consequences

Migration 047 is additive. Existing credentials/capabilities retain their previous
meaning. Integration-authored messages remain visible through existing Samvev
member projections, with the actual connection name/type. An HA-adapter rollback
can revoke the connection and retain the additive schema/data. Older backend
images do not understand the new message actor or native all-day marker; image
rollback is not validated or automatically safe. Prefer forward recovery, or
prepare and test a separate compatibility/data plan. Destructive down migrations
and automatic backup restoration over newer writes are not provided. This change does
not deploy either repository or install anything into the user's active HA.

The API contract is [HA_BRIDGE_API.md](../implementation/HA_BRIDGE_API.md).


## Explicit shared-native writes — 2026-11-13

Migration 048 adds `allowSharedNativeWrites`, false by default, to the existing
manager-owned per-connection sharing policy. The flag plus the existing paired
read/write capabilities authorizes changing readable native messages and genuine
native HA appointments within the same household. The full original and proposed
household/person audiences must remain within the grant. It does not expand the
meaning of old credentials or enable writes to imported calendars.

Native message authorship is established by creation lifecycle provenance;
worker/system-generated messages remain read-only even when their stored author
membership names a person. Original authors are preserved, while the editing HA
connection is recorded as the lifecycle/audit actor. Existing display targets are
retained only with explicit shared-native policy plus household-wide authority and
active same-household recipients. Display rows are locked against revocation and
expiry is rechecked after waits and before commit/replay. HA cannot change display
recipient selection.

Native appointment writes require server-owned `integration_items.ha_native_origin`
as well as the `haBridge` presentation marker, and independently exclude both
calendar metadata and occurrence relations. The JSON marker is producer-controlled
and cannot itself grant native authority. Migration 048 backfills origin from the
original connection's persisted HA creation receipt (matching household/event ID,
revision 1 and native result shape); HA creates set the column using a server SQL
literal, which generic item ingress cannot set. Generic producer events
remain read-only. Source IDs and provenance survive edits. Both row `readOnly`
flags and mutation/replay authorization use these same complete-audience and type
rules. The original source connection is pinned against revocation during writes.

There is no native local appointment editor/member CRUD API in the Samvev UI at
baseline `09bbd73`; the calendar interface is provider setup/import and viewing.
No UI-created appointment test is claimed. This change covers existing native
HA-authored appointments, including another explicitly authorized connection,
without inventing a UI or parallel calendar model. Removing the shared-native
policy is the narrow rollback; additive schema/data remain intact.
