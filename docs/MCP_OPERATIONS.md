# MCP operations and school-check guidance

Status: issue #33 local-candidate operations note. Public endpoint and live client interoperability are unverified. The described migrations 049 and 050 are additive and default-deny. Verify matching code and migration files are merged and deployed before using production setup. The URL `https://samvev.pabben.org/mcp` remains a planned endpoint pending public verification.

## OAuth and household boundaries

Migration 049 introduces MCP OAuth clients and grants, authorization requests/codes, token sets, and links to authorized people, displays, and resources. Access tokens and rotating refresh tokens are stored hashed. Reuse of a rotated refresh token revokes its grant. Only explicitly granted resources should be reachable; default is deny. Use the client setup in [MCP clients](MCP_CLIENTS.md), and verify server-side revocation after disconnecting a client.

## School sources and plans

Migration 050 stores approved school sources and weekly plans/history with stable household, person, source, school-year, and week identity. Compare-and-swap (CAS) revisions protect concurrent edits. Failed or stale fetches retain the last-good plan and must remain marked stale; they must not be described as current. Display access uses explicit grants and must not be inferred from household membership alone.

**PDF verification boundary:** bounded PDF snapshot support is a local candidate only until its code and migration 051 are merged and deployed. A successful snapshot can verify the retrieved PDF bytes and provenance (for example, approved URL, retrieval time, size, and content hash); that does **not** verify the meaning of its contents. The client must still inspect the exact PDF content and establish the configured class, current school year, and requested week from evidence in the document. Do not claim semantic verification from a link, successful fetch, hash, or stale snapshot. If exact content cannot be fetched or parsed, record a source failure and do not update a plan or prepare a notice from the PDF.

## Daily school-check prompt

Use this only after the school source has been configured and the client is authorized for the relevant household/person. The tool names below describe the local candidate. Do not run this prompt against a public service until deployment and tool schemas are verified.

> Start with `school.sources.list` for the authorized household and person. Use only the admin-approved source identity, URL, configured class, and current school-year/week context returned there; do not substitute a search result, a URL from old notifications, or a different class. Fetch that approved school page now. If it links the configured weekly PDF, fetch that exact PDF from the approved page and inspect its exact content. A successful fetch or matching PDF hash proves byte identity/provenance only, not that the document is semantically about the right class or week.
>
> Before saving, verify from the fetched page/PDF itself: exact configured class, school year, week start and end, source URL/identity, and freshness. If the class, year, or week is missing or ambiguous, stop. If fetch, redirect validation, PDF retrieval, or content inspection fails, call the available school source failure operation with the approved source identity and failure details; preserve the last-good plan and mark the result stale. Do not overwrite current plan data with a partial or stale result.
>
> For a verified result, record the observation time (`observedAt`), source revision (`sourceRevision`), source provenance, and uncertainty. Use `school.plans.upsert` with the current compare-and-swap revision from the existing plan. If no plan exists yet, follow the tool's documented create condition; never invent a revision. On a revision conflict, reload the plan and re-evaluate instead of overwriting. Do not invent dates, events, or packing instructions.
>
> Preserve every existing notification, its text, audience, delivery state, and expiry. Compare verified items with notifications for this same person, approved source, configured class, school year, and week only if you can read those records through an authorized tool. If you cannot inspect them, say that comparison is unavailable; do not claim the plan is unchanged or attempt a notice action. If a verified difference may warrant a notice, prepare a draft for an adult to review. There is currently no automatic MCP notice-write tool: do not send, publish, update, withdraw, delete, or broaden notifications as part of this check.

## Migration and rollback notes

- **049 and 050:** additive schema changes; older application code can ignore the new tables. Preserve the tables during application rollback unless a separately reviewed database rollback requires otherwise.
- Before rolling MCP application code back, revoke all MCP grants/tokens first so issued credentials cannot remain usable against other endpoints or later code.
- Do not use a destructive down migration as a routine application rollback. If database restoration is required, use a verified backup and follow the repository's scoped backup/restore procedure; restore only after coordinating with the deployment owner.
- **051:** local candidate; not publicly verified. Snapshot behavior is usable only after code and migration 051 are merged and deployed. Do not treat byte-integrity/provenance checks as semantic confirmation of class, dates, or instructions.

## Operator verification checklist

Before inviting a user to connect a client, verify that the deployed HTTPS endpoint responds, OAuth discovery metadata and redirect behavior match the chosen client, scopes are least-privilege, the client discovers only the intended tools, household/person/display grants filter data server-side, and revocation blocks subsequent requests. Test token expiration/refresh and rotated-token replay revocation. Test stale school-source handling, CAS conflict, explicit display grants, exact page/PDF class-year-week verification, and the no-notice-write boundary. Client compatibility and scheduled invocations remain unverified until separately exercised in each client.
