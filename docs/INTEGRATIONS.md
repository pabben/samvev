# Integration strategy

Integrations are adapters around a stable Samvev event, task, notice and action model. The core product must not depend on one smart-home, calendar or AI provider.

## Priority matrix

| Integration | Initial purpose | Target phase | Status |
|---|---|---:|---|
| Homey | Notifications, inbound events and allowlisted Flow actions | M1–M2 | Foundation requirement |
| Generic webhook | Receive Codex, GitHub, Axentra and custom events | M2 | Foundation requirement |
| Website/PDF | Monitor sources such as weekly plans | M2 | First source adapter |
| AI providers | Structured interpretation and summaries | M2 | Provider-neutral contract required |
| iOS push/widgets | Personal delivery and glanceable state | M3 | Native client planned |
| Shelly Wall Display XL | Compact shared display | M3 | Hardware validation required |
| Google Calendar | Read selected calendars | M3 R9 | Adapter implemented; app registration and real account validation required |
| Microsoft calendars | Read selected personal/work calendars subject to tenant policy | M3 R9 | Adapter implemented; app registration and real account validation required |
| ICS subscriptions | Private HTTPS calendar subscriptions | M3 R9 | Adapter implemented; actual subscription validation required |
| Home Assistant | Optional entities, services and generated dashboard | M4 | Optional adapter |
| Google Keep | Share-sheet import first | M4 | Continuous sync not assumed |
| Spond | Selected Google/Outlook cloud-calendar bridge | M3 R9 | Implemented reuse path; real Spond/account validation required; no private API |
| Samsung Family Hub | Curated calendar and/or browser display | M4 | Model-specific validation required |
| Google Nest Hub | TTS and temporary cast/status presentation | M4 | Validation required |

## Adapter requirements

Every adapter must document:

- official or supported access method
- authentication and token storage
- scopes/capabilities requested
- inbound and outbound data
- rate limits and retry behavior
- deletion and revocation
- privacy classification
- fallback behavior
- test strategy without real household data

## Integration health

Users must see:

- connected/disconnected state
- last successful operation
- last error in understandable language
- permissions granted
- a test button
- a revoke/remove path

## No fabricated capability

An integration proposal must not claim full synchronization or control until it is verified against current official documentation and tested. Unsupported approaches may be documented as experimental, but cannot be a required dependency.

## Round 9 calendar boundaries

See [calendar setup and scopes](CALENDAR_CONNECTIONS.md) and
[ADR 0022](decisions/0022-person-assets-calendar-and-task-subjects.md).
Snapshots cover the last seven and next 180 days; partial/malformed retrievals
never replace the last successful snapshot. Subjects, readers and paired
displays are independent selections. Preview is non-publishing; activation is
explicit. Disconnect locally fences callbacks/leases and withdraws imported
projections. Microsoft remote consent removal is not claimed by local disconnect.
ICS URLs remain encrypted, SSRF-checked and absent from provenance/logs.

The delivery report distinguishes adapter tests, actual browser/runtime checks,
and external-account evidence. OAuth app registration and real consent are not
simulated deployment successes. Google/Gemini is an assessment only; see the
[ChatGPT and Google guide](CHATGPT_PLAN_CONNECTION.md).
