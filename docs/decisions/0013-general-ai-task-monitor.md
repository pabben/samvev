# ADR 0013: General AI task and source monitor

- Status: Accepted
- Date: 2026-09-08

## Decision

Model monitoring as a general household task with an explicit draft → interpretation → approval flow. An explicit URL or domain in the instruction is extracted deterministically; a manual source overrides it. Missing, ambiguous and blocked sources fail closed, and the model never chooses an unseen source. Fetch sources deterministically, select bounded relevant content, and fingerprint exactly what AI receives before analysis.

An approved rule declares whether it produces dated events or a current answer. Both forms require an exact quote and final source URL. User-visible answer and event claims must be extractive and supported by that evidence before they can be stored or published. Event results retain their M1 message mappings; answer results are retained in household-protected run history.

Event identity is derived by Samvev from the event type, sorted affected people and deterministic occurrence order after chronological sorting. Date or description corrections therefore update the existing mapped message instead of trusting an arbitrary model-supplied identifier.

The worker and manual actions share the same leased fetch, analysis and validation pipeline. A pre-approval test and a stronger-quality preview record a run without activating, rescheduling, fingerprinting or publishing. An active manual run performs normal reconciliation while preserving its existing next scheduled check. Provider policy gates the existing single configured provider; it does not add automatic fallback.

## Consequences

The first source adapters support public HTML and text-based PDFs without browser login or OCR. An exact evidence quote and final source URL are required for every accepted event. A failed fetch, provider call or parser validation preserves the prior successful fingerprint and event set.

Monitor fetching has a stricter SSRF policy than local provider configuration: public destinations only, with validation and address pinning at each redirect.

The task keeps the approving membership as its authority. If that account is disabled or loses the capabilities needed to create, schedule or publish its selected targets, the worker pauses the task and withdraws its generated live/future messages before doing another fetch.

Monitor creation, editing, approval and manual production runs apply the same
message capabilities and per-membership display grants as direct message
creation. Interpretation is durably rate limited and serialized by a task lease,
so concurrent requests for one revision cannot multiply provider calls.

Quality remains an internal routine/strong tier. A user may preview the stronger tier and explicitly retain it for the task without reopening an approved rule or exposing provider/model terminology in the task flow.
