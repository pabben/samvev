# MCP operations and school-plan workflow

Status: local candidate at `f9df57f`; the public service remains on source `8391041...` with no MCP endpoint. Migrations 049–053 and `/mcp` are not deployed publicly. Do not use the placeholder `https://samvev.pabben.org/mcp` as if it were live. Client compatibility and scheduled runs are unverified; see [MCP clients](MCP_CLIENTS.md) and the [MCP tool matrix](MCP_TOOL_MATRIX.md).

## OAuth and resource policy

The MCP server uses provider-independent Streamable HTTP at `/mcp` and Samvev's own OAuth authorization server. A connecting client registers as a public client and uses Authorization Code + PKCE S256. An adult household administrator signs in, reviews the client identity and redirect URL, selects a household, and consents to named scopes plus separate person/display/school-source resources. Tokens are bound to the exact MCP resource URL. Scopes alone never grant cross-household or unlisted-resource access; each tool rechecks the current grant and household capabilities.

Authorization codes, access tokens and refresh tokens are stored as hashes. Refresh tokens rotate; replay of a rotated token revokes the grant's token sets. Client removal is not sufficient evidence of server-side revocation. Revoke the Samvev grant in its administration UI/API and verify that subsequent calls fail. Never share internal AI provider credentials, ChatGPT plan credentials, browser cookies or display credentials with MCP clients.

## School sources, plans, and PDF handling

Migration 050 keys a plan to an approved household/person/source/year/week. CAS revisions protect updates. A failed check to an existing plan retains its last-good content and marks the plan stale; never call stale data current. Display access requires explicit display/resource grants.

Migration 051 stores one bounded original PDF snapshot per plan and content revision. `school.plans.verify_pdf` fetches only the exact PDF link found on the approved same-origin class page, validates the bounded PDF bytes, records SHA-256 and verification time, and rechecks the plan revision and live authorization after the fetch. This establishes byte identity and provenance only; it does not determine whether the PDF means the right class, dates, or week. The MCP tool returns verification metadata, not PDF bytes or extracted text.

The member and paired-display school-week UI uses a protected same-origin API route to retrieve a verified snapshot. It shows the open-PDF action only when snapshot and sharing policy allow it. The browser opens an object URL in a new tab and provides a download fallback if opening is blocked. The paired display requires both the plan's display target and the source/connection display grant. The viewer is for a person to inspect the source; it does not make the PDF's contents available to an MCP model.

For a PDF-only first-use week, the MCP client cannot semantically inspect content through `verify_pdf`, and that tool requires a plan revision/link. Do not create a guessed plan to unlock the PDF. Ask an authorized adult to review the approved source in the school-week browser UI and provide/confirm the plan content through the supported workflow. If an existing plan cannot be checked, `school.plans.source_failure` can record an error and preserve last-good data. It requires an existing plan; a failed first-use check cannot create a failure row, so report the missing/unreadable source to the administrator without upserting content.

## Daily school-check prompt

Use only after the approved source, class and the client's household/person/resource scopes have been configured. This prompt is for the local candidate, not a public endpoint or unattended schedule.

> Call `school.sources.list` first. Use only the exact admin-approved source ID, person, class key and source-page URL returned for this authorization. Determine the current school week from the household timezone and calendar; verify the ISO year/week and Monday–Sunday dates. Fetch the approved class page itself. Do not substitute a search result, another class page, an old notification, or a PDF URL not linked by that exact page.
>
> Confirm the page is for the configured class and that the linked content is for the exact current year/week. Record `observedAt`, a stable `sourceRevision`, the source URL, and an honest uncertainty level. If the page links the week's PDF, `school.plans.verify_pdf` can store an exact bounded byte snapshot only after a plan with that URL and revision exists. Its SHA-256/verified time do not reveal or verify the document's meaning. Do not infer class/week content from a hash or fetch success. If you cannot inspect the exact content through an authorized source, do not upsert a plan from it.
>
> For a verified page-derived plan, call `school.plans.get` or `school.plans.list` to obtain the current revision, then call `school.plans.upsert` with that CAS revision and the observed time, source revision, verified class/year/week, and uncertainty. For a revision conflict, reload and re-evaluate; never invent a revision. If an existing plan's source is unavailable or unreadable, call `school.plans.source_failure` with the correct existing revision, check time, and failure reason. This operation cannot record a failure for a week with no plan yet; in that case, report the problem and make no upsert.
>
> Preserve all existing Samvev notifications exactly, including audience, delivery state and expiry. No MCP message or notification read/write tool is currently registered, so do not claim to have compared notifications and do not send, publish, update, withdraw, delete or broaden any notice. If a verified change may merit a notice, prepare a text-only draft for adult review and state that notification comparison/publication was unavailable. Do not invent dates, events, or packing instructions.

## Migration and rollback

| Migration | MCP candidate change | Rollback boundary |
|---|---|---|
| 049 | OAuth clients, grants, scope catalog, authorization/login/code/token records and explicit person/display/resource grants. Token and code values are hash-stored. | Keep tables/data on code rollback. Revoke MCP grants/tokens before rolling back the application. |
| 050 | Approved school sources, weekly plans/history and explicit display targets. | Keep last-good plans and grants on code rollback. Do not delete migrated records as an application rollback. |
| 051 | Bounded PDF snapshots linked to exact plan content revision and URL. | Keep snapshots with additive schema. Viewer access still rechecks current authorization; no public behavior is established. |
| 052 | Separate people, grocery-read and dinner-read scopes. | Keep the expanded scope catalog; missing scope consent remains default-deny. |
| 053 | Grocery/dinner write scopes and dinner-assignment actor check expanded to include integration actors. | Keep the widened check. After delegated board writes, do not roll back to code that has not been validated to read/replay integration-authored assignment metadata. Prefer forward recovery. |

For code rollback, first revoke relevant grants and stop/restart MCP clients so cached access tokens cannot continue. Preserve schema/data. Do not apply destructive down migrations or restore an old database over newer writes as routine rollback. A database restore requires a verified backup and the repository's scoped recovery procedure. Public rollback from schema 53 to source `8391041...` is not validated; in particular, board writes can leave actor records that older code may not understand.

## MCP versus internal AI

MCP is a user-delegated external client surface: the household administrator consents to a named client, scopes and resource grants; each MCP call rechecks live authority. The internal AI pipeline is a server-side provider path governed by household AI settings, encrypted provider credentials, task approval, provider-specific accounting and internal tool schemas. It does not accept MCP OAuth tokens or inherit a connected client's grants. Neither route may publish a notice or activate a recurring task outside its explicit domain authorization and approval flow. See [ADR 0027](decisions/0027-mcp-oauth-and-internal-ai-boundaries.md), [ADR 0012](decisions/0012-ai-provider-foundation.md), and [ADR 0021](decisions/0021-chatgpt-plan-oauth-and-usage-accounting.md).

## Release checks still required

The local candidate does not complete issue #33. Before public use, verify migrations 049–053 on a clean/restored database, exact OAuth metadata/redirect/resource/audience behavior, grant revocation and refresh replay, all 17 tool scopes and resource filters, board-write idempotency/CAS, PDF fetch bounds/revision fencing and browser fallback, UI/API/MCP parity, Home Assistant dashboard integration, and real-client interoperability. Test scheduled invocation separately; MCP transport support alone does not establish it. No production deployment or live client test is claimed here.
