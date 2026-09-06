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
| Google Calendar | Read selected calendars and write curated household output when enabled | M4 | Planned |
| Microsoft calendars | Personal and work/school calendar connections subject to tenant policy | M4 | Planned |
| ICS subscriptions | Sports and public schedules | M4 | Planned |
| Home Assistant | Optional entities, services and generated dashboard | M4 | Optional adapter |
| Google Keep | Share-sheet import first | M4 | Continuous sync not assumed |
| Spond | Event/calendar information where supported | M4 | Integration path requires research |
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
