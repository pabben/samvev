# ADR 0012: AI provider foundation

Accepted for M2.1, 2026-09-08.

Use the existing TypeScript API and PostgreSQL. A provider-neutral task carries
an operation (`generate`, `extract`, `classify`, `plan`), purpose, input,
requested routine/strong tier and source evidence. A normalized result carries
output, generation time, uncertainty and optional token usage. Providers never
authorize users, publish messages or activate schedules.

Keep provider configuration and usage household-scoped. Require the existing
`household.manage` capability and authenticated member session for all admin AI
endpoints; reuse CSRF/origin checks. AI starts disabled. Model identifiers are
admin configuration, with no model names in domain rules or automatic routing.

OpenAI Responses is the first runtime adapter. Use bounded requests, no automatic
retries and `store: false`. Connection tests make an explicit small inference,
so they validate the configured model and record real returned usage. No live
paid request runs during automated validation. Tests inject the HTTP transport.
Future adapters receive model, optional API key and base URL through server-side
configuration; M2.1 does not expose arbitrary endpoint URLs or implement local AI.

Encrypt saved provider credentials with authenticated encryption using a
server-only key outside Git. Return only a configured flag, never ciphertext,
key fragments, raw upstream errors or prompts. Usage stores provider/model,
time, purpose, success/failure and optional input/output counts, not content.

ChatGPT feasibility remains PARTIAL from the completed spike: Tasks can use
plugins, while a private MCP service needs a configured supported tunnel or a
reachable authenticated HTTPS endpoint and account/workspace access. No Samvev
connection is installed here. Reserve a bridge contract with source/time/
uncertainty and idempotency; report subscription mode unavailable in this slice.
Do not present the ChatGPT subscription as a server API credential, access web
session cookies, create an unofficial bridge or add the weekly-plan monitor.

Sources checked during the prior spike, 2026-09-07:
[scheduled tasks](https://learn.chatgpt.com/docs/automations),
[MCP connection requirements](https://developers.openai.com/plugins/deploy/connect-chatgpt),
[Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create).
The missing account/connection validation is tracked in the M2.1 delivery note.

Migration: additive AI settings/usage tables only; existing M1 schema remains
unchanged. Older M1 code can ignore these tables. Back up the encryption key
alongside the database; deleting the key requires re-entering API credentials.
