# ADR 0027: Provider-independent MCP OAuth and internal AI boundaries

- Status: Accepted for the local MCP candidate; public deployment and client interoperability pending
- Date: 2026-11-25

## Context

Samvev needs an external-agent surface for user-requested household operations. This is different from Samvev's internal AI providers and monitor pipeline, which run server-side under household AI settings and task authorization ([ADR 0012](0012-ai-provider-foundation.md), [ADR 0021](0021-chatgpt-plan-oauth-and-usage-accounting.md)). Reusing provider OAuth, API keys, browser cookies, or internal tool authorization for MCP would conflate identities and grant boundaries.

MCP clients also differ in transport, OAuth support, prompts and approval UX. Samvev therefore owns one provider-independent protocol endpoint and keeps authorization policy in its own server.

## Decision

1. **Transport and resource identity.** Expose MCP through Streamable HTTP at the installation's exact public-origin `/mcp` resource. Publish OAuth protected-resource and authorization-server metadata at the corresponding well-known URLs. Do not advertise the candidate URL until deployment and TLS are verified.
2. **OAuth.** Register public clients only. Use Authorization Code with PKCE S256, exact registered redirects, state, a fixed MCP resource/audience, and explicit adult-administrator consent. Store authorization codes, access tokens and refresh tokens as hashes. Rotate refresh tokens; replay revokes the grant's token sets. Never accept client secrets as a substitute for user consent.
3. **Scopes and resources.** Use an explicit catalog with separate read, write and lifecycle scopes. No wildcard scope. Scopes select tool families; separate grant rows limit the household, people, displays and approved school sources. Every call rechecks the live account, membership, grant, scope, capability and resource boundary. Revocation or role change takes effect on subsequent calls.
4. **Domain tools.** Reuse existing domain services rather than create a parallel MCP data model. Return only fields required for the operation. Household board writes use the established service, current revisions and durable request keys. School-plan writes require an approved source, authorized person/source, CAS revision and source observation metadata. Message reads use member visibility with explicit person grants. Message creation uses separate write consent, exact explicit person/display resources, and the delegated member's live rights; household-wide broadcast is denied. Calendar reads are bounded to explicitly granted people and source resources. MCP does not expose monitor mutation, credentials, calendar administration, display impersonation, or physical Home Assistant actions in this candidate.
5. **MCP and internal AI stay separate.** MCP tokens authorize calls from an external client only. Internal AI providers never receive or validate MCP tokens, and an MCP grant does not enable an internal model/provider route. Internal AI uses its own household configuration, encrypted credentials, cost/usage accounting, constrained schemas and task approval. OpenAI API credentials and ChatGPT subscription authorization remain separate as described in ADR 0021. Neither path may silently publish a notice or activate a recurring task.
6. **School PDF handling.** A school PDF fetch is allowed only for the exact link found on the approved class page and is size/rate bounded. The `school.plans.verify_pdf` result proves fetched-byte provenance, not semantic class/week/content. MCP does not return those bytes or extracted text. A separate same-origin member/display route serves a verified snapshot to the browser under current permissions, with a new-tab and download fallback. Browser access is for people; it is not a model-readable channel.
7. **Home Assistant school sharing.** Migration 057 adds independent, default-empty school-person and school-source grants to HA sharing. Generic calendar/message sharing does not imply school access. Snapshot data is limited to 20 matching plans overlapping the household-local window from seven days before through 21 days after today. It omits source/PDF URLs and PDF bytes; current authorization and source grants are rechecked for each snapshot.

The local candidate is the source tree at publisher `feat/mcp-integration-33` commit `06e0aab`, with migrations 049–057 and 21 registered tools. Public source `8391041ca17ffea124870118b7312f0c50e3da5c` (schema 48) does not contain this candidate or an MCP endpoint.

## Consequences and remaining validation

- Each client must be tested with the actual deployed metadata, redirects, scopes, browser consent, token refresh/revocation and tool schemas. Protocol support alone does not establish client interoperability or unattended scheduled calls.
- Focused combined tests passed 21/21 and API typecheck passed. A calendar SQL probe passed. Synthetic school Home visual and paired-display preview/live/grant-revocation QA passed; CSS fit at 1280×752, while the hero visual check remains pending. This is local synthetic evidence only. Public deployment, real ChatGPT/Codex/Claude/Gemini tests and scheduled-run behavior remain unverified. Issue #33 remains open; UI/API/MCP parity and final visual checks remain outstanding.
- Migrations 054 and 055 add message-read scope and calendar-source resource support/calendar-read scope; 056 adds separate message-write consent; 057 adds independent HA school person/source grants. Migration 053 adds board write scopes and broadens the dinner-assignment actor constraint for delegated integration writes. Revoke MCP grants and HA sharing before application rollback, preserve schema/data, and do not roll back to older code until it is proven to understand integration-authored records, calendar-source grants, and HA school grant fields. Prefer forward recovery; destructive down migration or automatic backup restore is not provided.

## References

- [MCP tool matrix](../MCP_TOOL_MATRIX.md)
- [MCP client compatibility](../MCP_CLIENTS.md)
- [MCP operations](../MCP_OPERATIONS.md)
- [ADR 0012: AI provider foundation](0012-ai-provider-foundation.md)
- [ADR 0021: ChatGPT OAuth and usage accounting](0021-chatgpt-plan-oauth-and-usage-accounting.md)
