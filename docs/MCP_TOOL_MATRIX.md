# MCP tool and domain-operation matrix

Status: local candidate on `feat/mcp-integration-33` at publisher HEAD `8378560` (2026-11-25). The 11 tools below are registered in this local candidate. They have not been deployed to the public service or tested against a public client. Public app/worker source remains `8391041ca17ffea124870118b7312f0c50e3da5c` (schema 48), which has no MCP endpoint. Main's merge `f79271c` does not include this candidate.

The local school source and weekly-plan UI is wired. Security/disclosure fixes from `4b9103a` are included in this candidate. Synthetic API/integration tests are not evidence of public deployment or client compatibility. A later board-write branch is not part of this candidate.

## Registered local MCP tools

| Tool | Operation | Required MCP scope | Server-side boundary / status |
|---|---|---|---|
| `samvev_context` | Read authorized household context and granted scopes | `mcp:context` | Local candidate; household is bound to OAuth authorization. Read-only. |
| `samvev_monitors_list` | List monitors without instructions, source URLs, people, or display audiences | `mcp:monitors:read` | Local candidate; household is authorization-bound. Read-only. |
| `household.people.list` | List people explicitly included in the OAuth grant | `mcp:people:read` and `household.view` | Local candidate; only granted people and minimal identity fields. Read-only. |
| `household.groceries.list` | Read household grocery items | `mcp:groceries:read` and `household.manage` | Local candidate; requires explicit household consent/scope. Read-only. |
| `household.dinners.list` | Read dinner assignments in a date range of at most 31 days | `mcp:dinners:read` and `household.manage` | Local candidate; explicit grant and bounded window. Read-only. |
| `school.sources.list` | List school sources explicitly granted to this client | `mcp:school-plans:read` | Local candidate; source/person resources must be granted. Read-only. |
| `school.plans.list` | List up to ten authorized plans, optionally filtered | `mcp:school-plans:read` | Local candidate; only granted people and sources. Read-only. |
| `school.plans.get` | Read one plan by source and ISO week | `mcp:school-plans:read` | Local candidate; source/person authorization is rechecked. Read-only. |
| `school.plans.upsert` | Create or update a weekly plan | `mcp:school-plans:write` | Local candidate; authorized source/person plus compare-and-swap revision, observation time, source revision, and uncertainty. Writes plan data only; does not write notifications. |
| `school.plans.source_failure` | Record a failed source check | `mcp:school-plans:write` | Local candidate; keeps last-good plan and marks source/plan stale. Does not write notifications. |
| `school.plans.verify_pdf` | Fetch and store a bounded PDF after checking the exact link on the approved class page | `mcp:school-plans:write` | Local candidate; external fetch is bounded/rate-limited and tied to approved source. PDF snapshot confirms byte provenance, not semantic correctness of class/week/content. |

Public status for every tool: **not deployed, not publicly verified, and not tested with a live ChatGPT, Codex, Claude, Gemini, or generic MCP client.** No automatic MCP notification/message write tool is registered.

## Existing UI/API domains not exposed by these tools

| UI/API operation | Current route/service | MCP availability |
|---|---|---|
| Household Home/dashboard read | `GET /api/v1/households/:householdId/home`, `/dashboard`; `services/api/src/app.ts`; requires `household.view` | No dedicated MCP Home tool beyond minimal `samvev_context`. |
| Monitors: create/update/delete, approve, pause/resume, run/interpret, result review | `/api/v1/households/:householdId/monitors...`; monitor services; API requires `household.manage` | Only the bounded monitor list tool is exposed. No monitor mutation/run tool. |
| People, memberships, accounts, invitations: create/update/administer | `/api/v1/households/:householdId/people...`, memberships/accounts; `services/api/src/app.ts`; route-specific `people.manage`, `account.manage`, and administrator checks | Only explicit-grant `household.people.list` read is exposed. |
| Messages: list/create/edit/withdraw and publish/schedule | `/api/v1/households/:householdId/messages...`; `services/api/src/app.ts`; e.g. `message.create.household`, `message.schedule`, `message.manage.household`, `message.publish.display` | No message read or write MCP tool. Preserve existing notifications; do not imply MCP can publish them. |
| Grocery list: add/edit/delete | `/api/v1/households/:householdId/groceries...`; `householdBoards`; `household.view` plus actor/resource checks | MCP only exposes read tool `household.groceries.list`; no MCP board-write tools in this candidate. |
| Dinner options/assignments: create/edit/delete | `/api/v1/households/:householdId/dinner-options...`, `/dinners...`; `householdBoards`; `household.view` plus actor/resource checks | MCP only exposes read tool `household.dinners.list`; no MCP board-write tools in this candidate. |
| Calendars: connect/configure/sync/disconnect; event views | `/api/v1/households/:householdId/calendar-connections...`; calendar services; route-specific household capability and owner checks | Not exposed. Calendar data and source credentials remain outside MCP. |
| Integrations and credentials: create/update/revoke | `/api/v1/households/:householdId/integrations...`; `services/api/src/app.ts`; `household.manage` plus credential-grant checks | Not exposed. Never return credential material. |
| Displays, pairing and grants | `/api/v1/households/:householdId/displays...`, `/display-setups...`; display service; `display.manage` and explicit privacy checks | Not exposed. MCP never impersonates a display account. |
| Home Assistant control actions | `/api/v1/households/:householdId/home-assistant/controls...`; HA control services; explicit entity/action grants | Not exposed. No physical/automation action through MCP. |
| School source administration and family school-week view | `/api/v1/households/:householdId/school-plan-sources...`, school-plan APIs; `apps/web/src/school-plan-sources.tsx`, `apps/web/src/school-week.tsx` | UI is wired in the local candidate. MCP source/plan tools above use separately granted household/person/source scopes. |

## Candidate scope and outstanding work

This local candidate is not issue #33 completion. Before release, outstanding items include UI/API/MCP parity review, a family-facing PDF viewer, the Home Assistant dashboard, and real client interoperability tests. The PDF snapshot is not proof that document content has the correct class, week, or instructions; that must be independently verified. The public endpoint remains absent at public source `8391041...` until deployment and live verification.
