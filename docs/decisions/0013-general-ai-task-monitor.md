# ADR 0013: General AI task and source monitor

- Status: Accepted
- Date: 2026-09-08

## Decision

Model monitoring as a general household task with an explicit draft → interpretation → approval flow. An explicit URL or domain in the instruction is extracted deterministically; a manual source overrides it. Missing, ambiguous and blocked sources fail closed. The approved URL is the root of a server-controlled source scope. As extended by ADR 0015, the model may choose that root or an exact same-origin link returned by Samvev during the current bounded run; it cannot introduce an unseen URL or perform network access itself.

An approved rule declares whether it produces dated events or a current answer. Both forms require an exact quote and final source URL. User-visible answer and event claims must be extractive and supported by that evidence before they can be stored or published. Event results retain their M1 message mappings; answer results are retained in household-protected run history.

Event identity is derived by Samvev from the event type, sorted affected people and deterministic occurrence order after chronological sorting. Date or description corrections therefore update the existing mapped message instead of trusting an arbitrary model-supplied identifier.

The worker and manual actions share the same leased source, tool, analysis and validation pipeline. A pre-approval test and a stronger-quality preview record a run without activating, rescheduling, changing the production dependency manifest or publishing. An active manual run performs normal reconciliation while preserving its existing next scheduled check. Provider policy gates the existing single configured provider; it does not add automatic fallback.

## Consequences

The first source adapters support public HTML and text-based PDFs without browser login or OCR. An exact evidence quote and final source URL are required for every accepted event. A failed fetch, provider call or parser validation preserves the prior successful fingerprint and event set.

Monitor fetching has a stricter SSRF policy than local provider configuration: public destinations only, with validation and address pinning at each redirect.

When several documents support a result, change detection refreshes the last
successful dependency manifest before another provider call. Public provenance
contains only source URLs and fetch times; compact internal audit excludes raw
source and model content. See ADR 0015 for the tool boundary and limits.

The task keeps the approving membership as its authority. If that account is disabled or loses the capabilities needed to create, schedule or publish its selected targets, the worker pauses the task and withdraws its generated live/future messages before doing another fetch.

Monitor creation, editing, approval and manual production runs apply the same
message capabilities and per-membership display grants as direct message
creation. Interpretation is durably rate limited and serialized by a task lease,
so concurrent requests for one revision cannot multiply provider calls.

Quality remains an internal routine/strong tier. A user may preview the stronger tier and explicitly retain it for the task without reopening an approved rule or exposing provider/model terminology in the task flow.

## Lifecycle and actions

The stored task state remains `draft`, `active` or `paused`. The API is the
authority for a derived lifecycle and its permitted actions; clients must not
infer readiness from a truthy compiled rule or from local request state.

| Derived lifecycle | Meaning | Available actions |
|---|---|---|
| `incomplete` | The draft has no schema-valid setup or usable targets. | Create setup, edit, delete |
| `setup_failed` | The most recent setup attempt failed. | Retry setup, edit, delete |
| `ready_for_approval` | The draft has a schema-valid setup and usable targets. | Test now, approve and activate, smarter preview, edit, delete |
| `active` | The approved task is scheduled and idle. | Run now, pause, smarter preview/quality choice, edit, delete |
| `paused` | The task is retained without scheduled work. | Test now, resume when its authority remains valid, smarter preview/quality choice, edit, delete |
| `running` | A non-expired task lease owns the current operation. | Refresh status |

Testing is optional before approval. A live lease temporarily blocks mutations
with `MONITOR_RUNNING`; the UI explains the state, refreshes automatically and
restores actions after completion or lease expiry. An expired lease does not
block deletion. Draft deletion never depends on provider availability, source
availability, successful interpretation or a previous test. Revision conflicts,
missing setup, invalid targets, active work and missing records use distinct API
codes so the client can refresh stale state and give a concrete recovery action.

Interpretation failures store only a normalized error code on the task. A retry
clears it before work begins and a successful setup clears it permanently. The
existing columns support these transitions, so this clarification needs no data
migration or record-specific recovery.
