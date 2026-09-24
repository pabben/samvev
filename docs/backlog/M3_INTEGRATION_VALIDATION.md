# M3-HA-001 — validate the future Home Assistant handoff

Status: open; local documentation issue only. No GitHub issue or workflow created.

Before claiming a supported Home Assistant/OpenAI integration:

- Obtain explicit authorization and non-production credentials for the chosen HA release/provider.
- Validate REST-command header secrets, JSON templating and response handling.
- Confirm the chosen provider exposes an `ai_task` entity and structured generation; a placeholder is not an installed integration.
- Map approved data to stable Samvev person/display IDs outside model control.
- Persist external IDs, exact submitted payloads and returned revisions across restarts. Retry identical payloads; reconcile 409 rather than blindly overwrite.
- Exercise timeouts, 401/403, 409, 429 and unavailable Samvev with bounded retries.
- Exercise create/update/withdraw, rotation/revocation and display consent with synthetic data.
- Verify secrets do not leak through HA traces/logs. Preserve source timestamps, language and uncertainty; never invent missing information.

The locally tested boundary is HTTP → PostgreSQL → authorized SSE projection →
browser. Real Calendar, Spond, school, weather and Nest fetching and actual AI Task
execution are intentionally unvalidated and inactive.
