# MCP tool and domain-operation matrix

Status: local candidate on `feat/mcp-integration-33` at `f9df57f` (2026-11-25). This snapshot registers 17 tools. Later candidate commits may change the count, so refresh this list from `services/api/src/mcp/service.ts` before release. Public app/worker source remains `8391041ca17ffea124870118b7312f0c50e3da5c` (schema 48) with no MCP endpoint. Main's merge `f79271c` does not contain the MCP candidate. No public client compatibility or issue completion is claimed.

The local candidate includes the wired school source/week UI, monitor status reads, grocery/dinner board writes, protected PDF browser/download fallback, and the security/disclosure fixes in `4b9103a`. Automated API tests use synthetic local households; they do not show public deployment or live ChatGPT/Codex/Claude/Gemini compatibility. Migrations 049–053 are present in the candidate only.

## Registered tools in `f9df57f`

| Tool | Operation | Required MCP scope | Safety boundary |
|---|---|---|---|
| `samvev_context` | Read authorized household context and granted scopes | `mcp:context` | OAuth resource and household bound; read-only. |
| `samvev_monitors_list` | List bounded monitor schedule/health status | `mcp:monitors:read` | Omits names, instructions, source URLs, people, audiences, and result content. |
| `samvev_monitor_get` | Read one monitor status and latest execution status | `mcp:monitors:read` | Omits monitor name, instructions, sources, audiences, and result content. |
| `samvev_monitor_runs_list` | List recent run status for one monitor | `mcp:monitors:read` | Bounded history; omits raw results, source, traces, and model output. |
| `household.people.list` | List explicitly granted household people | `mcp:people:read` | Requires `household.view`; minimal person fields and grant-scoped results only. |
| `household.groceries.list` | Read household grocery items | `mcp:groceries:read` | Requires `household.manage` and explicit whole-household consent. |
| `household.groceries.add` | Add one grocery item | `mcp:groceries:read`, `mcp:groceries:write` | Requires durable request key; board service enforces live authorization and idempotency. |
| `household.groceries.update` | Update/check/uncheck an item | `mcp:groceries:read`, `mcp:groceries:write` | Requires current revision and durable request key; actor/household checks apply. |
| `household.dinners.list` | Read assignments for at most 31 days | `mcp:dinners:read` | Requires `household.manage`, explicit consent, bounded date window. |
| `household.dinners.options.list` | List assignable dinner options | `mcp:dinners:read` | Requires `household.manage`; only active household options. |
| `household.dinners.assign` | Assign or clear one date's dinner | `mcp:dinners:read`, `mcp:dinners:write` | Requires current revision and durable request key; clear is a write and should be confirmed by the client. |
| `school.sources.list` | List explicitly granted school sources | `mcp:school-plans:read` | Source and person grants are checked server-side. |
| `school.plans.list` | List up to ten authorized plans | `mcp:school-plans:read` | Only granted people and sources; optional source/week filters. |
| `school.plans.get` | Read one authorized source/week plan | `mcp:school-plans:read` | Resource authorization is rechecked on each call. |
| `school.plans.upsert` | Create/update a source/week plan | `mcp:school-plans:write` | Requires an approved source/person, CAS revision, observation/source revision and uncertainty; does not publish notifications. |
| `school.plans.source_failure` | Record an unavailable/invalid source check | `mcp:school-plans:write` | Preserves last-good content and records stale/error state; does not publish notifications. |
| `school.plans.verify_pdf` | Fetch/store a bounded PDF snapshot from an exact link on the approved class page | `mcp:school-plans:write` | Requires authorized source and plan revision; network fetch is bounded/rate-limited. Confirms byte provenance, not semantic correctness. |

No MCP message/notification write tool is registered. An OAuth scope does not grant access to arbitrary people, displays, or school sources: the grant's person/display/resource rows and current server capabilities further constrain each call.

## UI/API operations not exposed by MCP

| Operation | Existing route/service | MCP boundary |
|---|---|---|
| Household Home/dashboard read | `GET /api/v1/households/:householdId/home`, `/dashboard`; `services/api/src/app.ts`; `household.view` | No equivalent full Home projection; `samvev_context` is minimal. |
| Monitor create/edit/delete, approve/pause/resume, run/interpret, result content | `/api/v1/households/:householdId/monitors...`; monitor services; `household.manage` | Status reads only; no monitor mutation or result-content tool. |
| People, memberships, accounts, invitations: create/administer | `/api/v1/households/:householdId/people...`, membership/account routes; `people.manage`, `account.manage`, administrator checks | Only grant-scoped `household.people.list`. |
| Messages: read/create/edit/withdraw/schedule/publish | `/api/v1/households/:householdId/messages...`; `message.create.household`, `message.schedule`, `message.manage.household`, `message.publish.display` as applicable | No message/notification tool. Preserve existing notification state and audience. |
| Grocery list and dinner boards | `/api/v1/households/:householdId/groceries...`, `/dinner-options...`, `/dinners...`; `householdBoards` | MCP exposes scoped grocery add/update and dinner assignment in addition to reads; no dinner-option mutation tool. |
| School source approval and school-week display | `/api/v1/households/:householdId/school-plan-sources...`, school-plan routes; `apps/web/src/school-plan-sources.tsx`, `apps/web/src/school-week.tsx` | UI is wired locally. MCP client grants are a separate consent layer and cannot administer the source list. |
| Calendar connections/events | `/api/v1/households/:householdId/calendar-connections...`, calendar services | Not exposed; private calendar data and credentials stay outside MCP. |
| Integration credentials, displays/pairing/grants, Home Assistant controls, AI provider settings | Existing household API/service routes | Not exposed. No credential retrieval, display impersonation, physical action, or internal AI-provider administration through MCP. |

## Deployment and remaining work

All 17 tools are **local-candidate only**. Public source `8391041...` has no `/mcp` endpoint, and main merge `f79271c` does not include the candidate. Remaining work includes cross-surface UI/API/MCP parity review, Home Assistant dashboard integration, client interoperability and scheduled-run testing, and release/deployment validation. The school-week browser fallback is implemented locally, but public display/viewer behavior is unverified. Do not treat the PDF snapshot hash as proof that the PDF describes the correct class, week, or instructions.
