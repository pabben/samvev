# Round 17f — school task follow-up (2026-11-05)

Publicly verified source before R17f: `f99c68876f4c766cf09cdd92d2ccdef4c90d6721`; review `e523eeaeab878be4fb382f079ed6c92ee67107af`. The visual source and screenshot manifests remain unchanged. This note records only allowlisted run metadata; it does not claim a successful school result.

R17f source `bc2baefc5046020637bdaa79530e8643d813b6de` is now publicly deployed and verified on schema 46. Exact-source runtime build, guarded prepare/cutover/postrestore, pre/post backups with isolated restores, app/worker/database health, and HTTP health 200 passed. HTTPS synthetic browser smoke passed 11/11 with 13/13 expected asset hashes; it performed no non-auth content mutation. The temporary local synthetic credential copy was removed. Immediate code-only rollback is the preceding public R17e image/source `f99c68876f4c766cf09cdd92d2ccdef4c90d6721`. No live database restore was performed. No R17f scheduled school success is observed; task B remains paused.

## Task A: answer evidence

On R17e, scheduled A runs reached evidence validation instead of the previously observed `output_limit_reached` failure, but the existing approved task still fails. The latest read-only observation at 2026-11-05 18:15 UTC was `AI_RESPONSE_INVALID`, stage `evidence_anchor`, reason `quote`. Other recent runs reported `source`, `claim`, or schema mismatch. Successful web tool provenance includes two HTML documents in most sampled runs and an HTML/PDF combination in some runs. This proves the model reaches evidence validation; it does not reveal the private model output or establish which sentence caused rejection.

The previous answer prompt showed optional `sourceUrl` and `claims` inside its example JSON while also telling the model to omit them. R17f removed those optional fields from the requested example and asks for the same exact copied text in `answer` and `evidence.quote`. Server-side exact-source, quote, locale, schema and permission validation stay unchanged. No approved task, schedule, provider configuration or source was edited, and no manual model call was made. A natural scheduled success is required before calling this a repair.

R17f passed 37 targeted monitor integration tests and the complete isolated workspace suite (723/723), plus `npm run check`, on codex-dev against Compose `samvev-m1` service `test-db` / database `samvev_test`. These synthetic checks do not test whether the live local model obeys the revised prompt.

## R17g: exact answer-evidence diagnostics

An ordinary scheduled A execution **started** 2026-11-05 19:15:38 UTC on the R17f worker and completed 19:18:36 with `AI_RESPONSE_INVALID` at `evidence_anchor/quote`. This confirms R17f did not repair A. No manual task or model call was triggered. The historical model output was not retained in safe diagnostics, so its exact fault cannot be established.

Code tracing found one model-visible document per successful `web.open`: `MonitorSourceFetcher` extracts and NFKC-normalizes HTML/PDF text; `boundedPayload` serializes bounded title, headings, link labels and text, and derives the server-held `evidenceDocument` from those exact visible fields. The answer validator receives that document, not the full fetched text. Its whitespace normalization collapses line breaks within a field but does not join unrelated fields or accept approximate claims. A different source URL, quote absent from its opened document, answer absent from the quote's document, and answer not supported by the quote had all collapsed to `quote` in the answer path. These are distinct technical causes; the R17f run metadata does not identify which one occurred.

The R17g diagnostic candidate assigns bounded allowlisted reasons `source_unopened`, `quote_not_in_source`, `answer_not_in_source`, `answer_not_in_quoted_source`, and `answer_not_in_quote` while retaining the same rejection conditions and source/quote/answer checks. It stores no raw model response, quote, school content, URL or person data in error details. A synthetic regression was red before the change and green afterward. Local runner checks passed: agent-runner/domain 61/61, durable scheduled-worker integration 38/38 including the new persisted safe-error test, workspace typecheck, and complete isolated QA 725/725 (web 253, contracts 7, core 3, API 462, worker 0) against `samvev_test`. Public deployment status is recorded separately when completed. **This is observability, not a verified repair of A.**

## Task B: authorization and source fetch

The latest scheduled B run at 2026-11-03 01:10 UTC failed `MONITOR_OWNER_UNAUTHORIZED`, and the task is paused. A read-only check found the approving account and required capabilities still present. Its one selected display is revoked. Server authorization correctly blocks publication to that display and withdraws generated live/future messages. The task must remain paused until an authorized household administrator explicitly chooses an active display or removes the display target, reviews recipients and resumes it through the UI. No grant, target, approval or schedule was changed here.

B's earlier `MONITOR_SOURCE_TIMEOUT` is a separate unresolved failure. The 2026-11-02 run stopped during the source request; a prior isolated read-only fetch succeeded once, which does not prove reliable scheduled access. After authorized reactivation, inspect a natural scheduled run before claiming B fixed. Do not copy the task or trigger a model call to test the owner decision.

No raw school content, person names, URLs, credentials or model responses were recorded in this note.
