# ADR 0018: Registered synthetic identity for deployed-runtime E2E

- Status: Accepted; isolated actual-model validation passed, live deployment pending
- Date: 2026-09-14

## Context

Technical regression tests must be repeatable without asking an owner to operate
the browser, borrowing an owner's session, or inserting session rows. The
existing immutable deployment does not expose a supported synthetic identity
attestation or execution-scoped diagnostic API. Passing tests in a separate QA
runtime alone cannot demonstrate that a deployed live candidate is working.

## Decision

An opt-in operator provisioning command creates one registered synthetic
household, one synthetic person and one account carrying the household-administrator
role label needed by the existing UI. Its server-side capabilities are restricted
to the exact four operations needed by the harness: view/manage this household and
create/schedule its messages. It uses normal password hashing and does not grant
installation ownership. The
registration stores a hash of an opaque marker; the credential file, including
the marker, is written exclusively with mode 0600 outside version control.
Provisioning is idempotent for the same registration and fails closed if the
identity has acquired another household membership or its binding has changed.
No account sessions are provisioned. The test harness signs in and signs out
through the ordinary HTTP authentication endpoints, shares the resulting browser
cookie jar, and supplies the normal CSRF token for mutations.

Before opening the authenticated application, the harness compares `/me` and
an authenticated attestation against every expected identity ID and the marker
hash. Exactly one membership must exist and its household must be registered as
synthetic. Attestation is repeated before test mutations and cleanup. A browser
request guard blocks household paths outside the attested household.

`SAMVEV_LIVE_E2E_ENABLED=true` enables the narrowly scoped attestation, evidence
and public synthetic weekly-plan fixture endpoints. The fixture contains only
fixed synthetic content and a server-calculated next-day date; it does not
reflect request input or private data and has a durable per-IP rate limit. The
evidence endpoint requires both
normal household authorization and the registered identity binding. It returns
only execution-scoped tool provenance, allowlisted telemetry, required tools,
cache metadata and message counts, without model names, credentials, reasoning,
prompts or raw source/result text.

The harness uses only draft monitors targeting its own synthetic person and no
displays. Test now must not activate or publish messages. Each invocation has an
opaque UUID, each task name is scoped to that invocation, and sequential terminal
runs must have distinct execution IDs. Representative duplicate requests must return
the same active ID. The harness probes this once for browser setup and once
for its first Test now, only after reading the persisted active state. Other
repeatability actions enqueue once to preserve the production rate-limit budget. Reload must reconnect without enqueueing. Cleanup waits for
terminal work, deletes through the ordinary revision-checked API and verifies
absence. A response-lost create is recovered for cleanup by its invocation name.
An unresolved residue is retained as opaque IDs in an ignored mode-0600 report.

Local AI settings are supplied in a separate mode-0600 secret file and written
only to the attested synthetic household through the existing authenticated
settings API and credential vault. The harness never reads or copies real
household settings. It does not persist cookies, browser storage, traces or
screenshots. Reports contain only check names, hashed execution IDs, allowlisted
error codes and numeric timing. External read-only MET/Kartverket requests and
the public synthetic weekly-plan page supplement deterministic CI fixtures.

## Repeatability and provenance

The matrix covers weather three times, weather via Yr three times, combined
web and weather three times, and a negative no-events case twice. Positive and
negative cases use explicit synthetic temperature thresholds independent of the
normal range of tomorrow's forecast. They validate result semantics rather than
changing production validation or fabricating weather responses. Required tools,
execution IDs, source timestamps, fingerprints, cache state, no-message state and
clean draft state are checked on each execution. A cached source may retain its
fetch timestamp only when the current execution explicitly attests a cache hit
or revalidation; merely reusing a prior audit row is insufficient.

## Deployment boundary and rollback

Migration 015 adds the synthetic registration and execution evidence links.
Migration 016 adds bounded, allowlisted failure diagnostics used by the harness;
migration 014 and durable-run bounds are unchanged. This mechanism cannot run against the older live image
that lacks its supported endpoints. First pass local/isolated QA, then authorize
an immutable infrastructure deployment and provisioning; run the same harness
against that deployed candidate. Never claim live PASS from intercepted browser
routes or a staging-only run. Feature fixes remain blocked until automated live
repeatability passes. No merge is implied.

Stop new invocations and allow active executions to reach a terminal state before
rollback. Disable the E2E flag to remove public fixture and diagnostic routes.
The additive registration schema can remain; do not drop live household data or
restore a database merely to remove test functionality. Revoke test credentials
through the supported account administration flow if access must be withdrawn.

## Consequences

Owner acceptance remains valuable for visual quality, natural language and
usefulness. Authentication, repeated execution, deduplication, reconnect,
provenance and cleanup become automated technical criteria. Strong tenant
isolation is a prerequisite; attestation failure requires investigation or an
isolated staging deployment, never bypassing the guard.
