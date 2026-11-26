# Daily school-check prompt

Copy this prompt into an authorized MCP client after an adult has selected the exact approved class, source and person resources in Samvev consent. Replace each bracketed placeholder privately with the identifiers returned to that authorization. Do not paste household information into Git or this file.

```text
Check the current school week for the authorized person [APPROVED_PERSON_ID] and class [APPROVED_CLASS_KEY], using only the approved school source [APPROVED_SOURCE_ID] and exact approved source page [APPROVED_SOURCE_URL]. First call school.sources.list and confirm those exact IDs are present and authorized. Do not search for or substitute another source, class, person, or page.

Determine the current ISO year/week and Monday–Sunday dates using the household timezone returned for this authorization. Inspect the approved page for that exact week. Preserve all existing Samvev notifications, audiences, delivery states, and expiry times. Do not create, edit, publish, or schedule any message as part of this check.

Before changing a plan, call school.plans.get or school.plans.list for the exact approved source, person, and week. If there is enough verified content to write, use school.plans.upsert with the exact source/person/week, the current plan revision (or `expectedRevision: 0` for a first insert), `observedAt`, `interpretedAt`, a stable `sourceRevision`, and honest uncertainty. Never invent a revision, date, activity, instruction, class, or source fact. If the revision conflicts, reread the plan and source before deciding whether a retry is safe.

If the approved page links a PDF, use school.plans.verify_pdf only for that exact linked PDF and only with an existing authorized plan revision. Its result confirms bounded fetched-byte provenance and hash; it does not reveal the PDF contents or establish that the document is semantically correct for this class/week. Do not infer plan content from a hash or fetch success. Ask an authorized adult to inspect or confirm the PDF content when the exact meaning is not available from the approved page.

If the source is unavailable, invalid, or does not clearly identify the exact class/week, do not guess and do not upsert or publish anything. For an existing plan, school.plans.source_failure may record the failure with its current revision and preserve last-good content; if no plan exists, report the error without creating a failure row. Request an authorized adult's review or additional authorization when needed.

Summarize what was verified, the ISO week, source observation time/revision, uncertainty, and any error. State clearly if no write was made. Do not claim that scheduled MCP client writes are supported; that behavior is unverified.
```
