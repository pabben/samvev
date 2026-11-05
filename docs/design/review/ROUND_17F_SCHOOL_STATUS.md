# Round 17f — school task follow-up (2026-11-05)

Publicly verified source before this change: `f99c68876f4c766cf09cdd92d2ccdef4c90d6721`; review `e523eeaeab878be4fb382f079ed6c92ee67107af`. The visual source and screenshot manifests remain unchanged. This note records only allowlisted run metadata and a code candidate; it does not claim a successful school result.

## Task A: answer evidence

On R17e, scheduled A runs reached evidence validation instead of the previously observed `output_limit_reached` failure, but the existing approved task still fails. The latest read-only observation at 2026-11-05 18:15 UTC was `AI_RESPONSE_INVALID`, stage `evidence_anchor`, reason `quote`. Other recent runs reported `source`, `claim`, or schema mismatch. Successful web tool provenance includes two HTML documents in most sampled runs and an HTML/PDF combination in some runs. This proves the model reaches evidence validation; it does not reveal the private model output or establish which sentence caused rejection.

The current answer prompt showed optional `sourceUrl` and `claims` inside its example JSON while also telling the model to omit them. The R17f code candidate removes those optional fields from the requested example and asks for the same exact copied text in `answer` and `evidence.quote`. Server-side exact-source, quote, locale, schema and permission validation stay unchanged. No approved task, schedule, provider configuration or source was edited, and no manual model call was made. A natural scheduled success is required before calling this a repair.

The candidate passed 37 targeted monitor integration tests and the complete isolated workspace suite (723/723), plus `npm run check`, on codex-dev against Compose `samvev-m1` service `test-db` / database `samvev_test`. These synthetic checks do not test whether the live local model obeys the revised prompt.

## Task B: authorization and source fetch

The latest scheduled B run at 2026-11-03 01:10 UTC failed `MONITOR_OWNER_UNAUTHORIZED`, and the task is paused. A read-only check found the approving account and required capabilities still present. Its one selected display is revoked. Server authorization correctly blocks publication to that display and withdraws generated live/future messages. The task must remain paused until an authorized household administrator explicitly chooses an active display or removes the display target, reviews recipients and resumes it through the UI. No grant, target, approval or schedule was changed here.

B's earlier `MONITOR_SOURCE_TIMEOUT` is a separate unresolved failure. The 2026-11-02 run stopped during the source request; a prior isolated read-only fetch succeeded once, which does not prove reliable scheduled access. After authorized reactivation, inspect a natural scheduled run before claiming B fixed. Do not copy the task or trigger a model call to test the owner decision.

No raw school content, person names, URLs, credentials or model responses were recorded in this note.
