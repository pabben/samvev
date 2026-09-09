# ADR 0013: General AI task and source monitor

- Status: Accepted
- Date: 2026-09-08

## Decision

Model monitoring as a general household task with an explicit draft → interpretation → approval flow. Fetch sources deterministically, select lines matching approved rule terms with adjacent context, and fingerprint that relevant view before AI analysis. Persist extracted events and their M1 message IDs so a later complete extraction can update or withdraw notifications idempotently.

Event identity is derived by Samvev from the event type, sorted affected people and deterministic occurrence order after chronological sorting. Date or description corrections therefore update the existing mapped message instead of trusting an arbitrary model-supplied identifier.

The worker uses short database leases and performs source/AI work outside the claim transaction. Its monitor loop runs independently from the M1 lifecycle loop. Provider policy gates the existing single configured provider; it does not add fallback.

## Consequences

The first source adapters support public HTML and text-based PDFs without browser login or OCR. An exact evidence quote and final source URL are required for every accepted event. A failed fetch, provider call or parser validation preserves the prior successful fingerprint and event set.

Monitor fetching has a stricter SSRF policy than local provider configuration: public destinations only, with validation and address pinning at each redirect.

The task keeps the approving membership as its authority. If that account is disabled or loses the capabilities needed to create, schedule or publish its selected targets, the worker pauses the task and withdraws its generated live/future messages before doing another fetch.
