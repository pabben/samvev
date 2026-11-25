# MCP operations and school-check guidance

Status: issue #33 operations note based on backend implementation notes pending merge into this documentation branch and live verification. The described migrations 049 and 050 are additive and default-deny. Verify the matching code and migration files are merged and deployed before following endpoint setup. The public URL `https://samvev.pabben.org/mcp` is a placeholder until confirmed live.

## OAuth and household boundaries

Migration 049 introduces MCP OAuth clients and grants, authorization requests/codes, token sets, and links to authorized people, displays, and resources. Access tokens and rotating refresh tokens are stored hashed. Reuse of a rotated refresh token revokes its grant. Only explicitly granted resources should be reachable; default is deny. Use the client setup in [MCP clients](MCP_CLIENTS.md), and verify server-side revocation after disconnecting a client.

## School sources and plans

Migration 050 stores approved school sources and weekly plans/history with stable household, person, source, school-year, and week identity. Compare-and-swap (CAS) revisions protect concurrent edits. Failed or stale fetches retain the last-good plan and must remain marked stale; they must not be described as current. Display access uses explicit grants and must not be inferred from household membership alone.

**PDF limitation:** current behavior stores an unverified HTTPS PDF link only. It does not fetch or store PDF bytes and cannot claim that the PDF contents were verified. A bounded, verified PDF snapshot is contingent on migration 051 and a separate confirmed implementation. Until that work is merged and tested, do not interpret PDF-only changes, summarize PDF contents, or publish notices based on them. If a school page links a PDF and no independently verified class/week data exists, report that verification is unavailable and publish nothing.

## Daily school-check prompt

Use this only after the school source has been configured and the client is authorized for the relevant household/person. It cannot compensate for missing source verification or unavailable MCP tools.

> Check the approved school plan for the configured class and this current school week. First confirm the class, source identity, school year, week start/end, fetch time, and freshness from Samvev's verified plan data. Do not infer the class or week from an old notification, an unverified link, or a PDF whose contents Samvev has not verified. If any required identity or freshness check fails, report what is missing and make no publication.
>
> Compare verified items with existing Samvev notifications for the same person, source, class, and week. Preserve all existing notifications and their audience/expiry settings. If the verified plan is unchanged, make no edit and create no duplicate. If a verified change requires a notice, update the matching existing notice in place when an authorized update operation exists; otherwise prepare a proposed notice and ask for approval. Publish only after the tool confirms the class/source/week evidence and the caller has the required permission. Include the source and retrieval time in the notice, state any uncertainty, and do not invent dates, events, or packing instructions. Never delete, withdraw, or broaden an existing notification as part of this check.

## Migration and rollback notes

- **049 and 050:** additive schema changes; older application code can ignore the new tables. Preserve the tables during application rollback unless a separately reviewed database rollback requires otherwise.
- Before rolling MCP application code back, revoke all MCP grants/tokens first so issued credentials cannot remain usable against other endpoints or later code.
- Do not use a destructive down migration as a routine application rollback. If database restoration is required, use a verified backup and follow the repository's scoped backup/restore procedure; restore only after coordinating with the deployment owner.
- **051:** not yet confirmed. School PDF snapshot support and migration 051 are contingent and must not be included in operator expectations until merged and validated.

## Operator verification checklist

Before inviting a user to connect a client, verify that the deployed HTTPS endpoint responds, OAuth discovery metadata and redirect behavior match the chosen client, scopes are least-privilege, the client discovers only the intended tools, household/person/display grants filter data server-side, and revocation blocks subsequent requests. Test token expiration/refresh and rotated-token replay revocation. Test stale school-source handling, CAS conflict, explicit display grants, and the no-publication path when class/source/week evidence is missing. Client compatibility and scheduled invocations remain unverified until separately exercised in each client.
