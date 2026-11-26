# MCP client compatibility

Status: research snapshot, 2026-11-26. Local candidate `334e4df` contains 43 MCP tools through migration 071; its exact isolated suite passed 925/925, API/web typechecks and isolated build passed. A synthetic schema-71 restore remains pending. The schema-48→70 restore applies only to predecessor `36487d5`. Public source remains `8391041ca17ffea124870118b7312f0c50e3da5c` (schema 48), with no MCP endpoint. Public restore and named-client validation remain unverified. No named client has been connected or tested against a live Samvev endpoint; client compatibility and scheduled invocation remain unknown.

## Client status

| Client | Documented MCP support | What this means for Samvev | Samvev test status / scheduled runs |
|---|---|---|---|
| ChatGPT | OpenAI documents remote custom MCP servers with OAuth; availability and write support depend on plan and workspace controls. [Connection guide](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) | The local candidate has read and write tools, including grocery/dinner and school-plan writes, restricted message create/edit/withdraw, profile-only updates, minimal granted-display listing, separately consented display-setup reads, layout writes requiring fresh `mcp:displays:layout:write` consent, and bounded monitor-result reads, plus separately consented update/delete for same-grant inert monitor drafts. Draft deletion is permanent; current-revision CAS applies. Message edits use revision CAS and explicit recipient checks; household-wide audiences remain denied. Public endpoint, OAuth, workspace policy, and tool confirmations remain unverified. | Not tested against live Samvev. Do not assume scheduled ChatGPT MCP writes work; scheduled invocation and consent continuity are unknown. |
| Codex | OpenAI documents remote HTTP MCP configuration and OAuth login in Codex CLI. [Codex MCP documentation](https://developers.openai.com/codex/mcp/) | Setup can use `codex mcp add <name> --url <endpoint>` then `codex mcp login <name>` when the endpoint is reachable and supports the advertised OAuth flow. Samvev scopes include writes; actual auth and tool approvals remain untested. | Not tested against live Samvev. Scheduled/background runs are client- and environment-specific; unknown. |
| Claude (web/Desktop) | Anthropic documents remote MCP connectors for Claude, Cowork, and Claude Desktop; the MCP guide also documents local Desktop servers. [Remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [Desktop/local MCP](https://modelcontextprotocol.io/docs/develop/connect-local-servers) | Remote connector setup is available where the account/plan supports it. No Samvev connector is published; transport/auth interoperability remains untested. | Not tested against live Samvev. No verified scheduled Samvev tool execution; unknown. |
| Claude Code | Official docs cover remote HTTP and local stdio MCP servers, including OAuth. [Claude Code MCP](https://code.claude.com/docs/en/mcp) | `claude mcp add --transport http samvev <endpoint>` and authenticate through `/mcp`; actual Samvev auth remains untested. | Not tested against live Samvev. Scheduled jobs may run in distinct environments and require a separate authenticated connection; unknown. |
| Gemini Apps | Google documents custom MCP connected apps; availability is currently restricted by account, region and language. [Custom apps for Gemini](https://support.google.com/gemini/answer/17209137) | The guide documents adding an MCP server URL and OAuth credentials where DCR is unsupported. Samvev availability and OAuth interoperability are untested. | Not tested against live Samvev. No evidence that scheduled Gemini tasks can invoke Samvev without interactive confirmation; unknown. |
| Gemini CLI | Google's official CLI docs describe MCP configuration, HTTP transports and OAuth flows. [Gemini CLI MCP](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md) | It can be configured with a remote endpoint and `/mcp auth`; actual Samvev transport/auth remains untested. | Not tested against live Samvev. Any scheduled command requires a separately configured CLI runtime and auth; unknown. |
| Gemini API / other model APIs | The Gemini API documents function calling; API model tool calls are not themselves proof of an MCP client. [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling) | An application can adapt MCP tools through a client/runtime, but the app must implement the connection and authorization. | Not tested. Scheduled use depends on the application that runs the client; unknown. |
| Generic MCP clients | MCP is a protocol with client/server guidance; each client chooses transports, OAuth behavior, and approval UX. [MCP documentation](https://modelcontextprotocol.io/docs) | Expect compatibility only after validating the actual transport, authentication, scopes, tool schema, and confirmation behavior in that client. | A synthetic JSON-RPC client passed local TCP initialization, discovery, read, invalid-token and revocation checks at `660b89c`. No third-party client, public endpoint or scheduled invocation has been verified. |

## Setup URL placeholder

When a deployed endpoint exists, enter the verified MCP endpoint shown here:

```text
https://samvev.pabben.org/mcp  # planned placeholder; not verified or deployed
```

Do not create credentials or copy secrets into this document. The exact OAuth discovery URLs, scopes, redirect behavior, and refresh-token behavior must be confirmed against the deployed service. Until then, the following are client-side setup outlines only; they are not evidence of a working Samvev connection.

## Setup outlines (endpoint must be live first)

### ChatGPT web

Open **Plugins** (or the workspace's custom app settings), choose **Add custom MCP server**, enter the deployed HTTPS endpoint, choose OAuth if offered, sign in, and scan the tools. In a managed workspace, an admin/owner may need to enable the feature and publish the app; available actions depend on plan and policy. The local source limits profile updates to explicitly granted people and display listing, setup reads, appearance updates, and separately consented layout writes to explicitly granted displays. Setup reads require fresh `mcp:displays:setup:read` consent and return only setup name/revision/version, cards, card order, family-layout flag, locale, and theme. Layout updates require fresh `mcp:displays:layout:write` consent and the current setup version; they preserve private selections and grants. Message create/edit/withdraw use the existing message-write scope and require recipient grants plus live member rights; household-wide audiences are denied. Native calendar create/update/delete require paired calendar read/write scopes, explicit native-calendar resource consent, and approved person grants; provider/ICS/HA calendars remain read-only. Browser CRUD, recurrence, broadcast, and display parity are still missing. The edit tool requires revision CAS and returns only ID, state, and revision. `samvev_monitor_result_get` requires separate default-deny `mcp:monitors:content` consent. Full isolated suite passed 911/911 on code candidate `b9aa974`; logs are listed above. Public endpoint and live ChatGPT compatibility remain unverified. Draft creation requires both `mcp:monitors:read` and `mcp:monitors:draft:write`, creates at most 50 drafts per grant per rolling day, and cannot select recipients or activate monitoring. Draft update/delete require the separate `mcp:monitors:draft:manage` scope and only operate on eligible inert drafts created by the same grant; deletion is permanent and CAS-protected. Browser completion and explicit approval are required. Public endpoint and live ChatGPT compatibility remain unverified. Grant only the scopes and resources needed. OpenAI advises checking that OAuth supports refresh tokens (`offline_access`) if the connection must persist. Do not create a ChatGPT scheduled task that writes to Samvev until scheduled calls, approval prompts, token refresh and idempotency have been verified end to end. [Official setup and OAuth notes](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt).

### Codex CLI

```sh
codex mcp add samvev --url https://samvev.pabben.org/mcp
codex mcp login samvev
codex mcp list
```

The URL is still a placeholder. Codex documents `codex mcp login` for OAuth servers and may use dynamic registration or metadata-based registration depending on server metadata. If a browser is unavailable, use `codex mcp login samvev --no-browser` and follow its printed URL/callback instructions. Never put client secrets in a committed `config.toml`. Verify discovered tools and scopes. [Codex MCP reference](https://developers.openai.com/codex/mcp/).

### Claude web / Desktop remote connector

In Claude settings, open **Connectors**, add a custom connector, enter the deployed remote MCP URL, then complete the OAuth login. Organization owners may need to add/allow the connector first. Remote connectors are reached from Anthropic's cloud; the server must be publicly reachable over HTTPS/443. Local-only network access is insufficient. [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

### Claude Code

```sh
claude mcp add --transport http samvev https://samvev.pabben.org/mcp
```

Then run `/mcp` inside Claude Code and follow the browser authorization flow; `claude mcp list` and `claude mcp get samvev` show connection state. If the server later needs removal, use `claude mcp logout samvev` before `claude mcp remove samvev` where revocation is supported; removing the local config alone does not revoke server-side credentials. [Claude Code MCP reference](https://code.claude.com/docs/en/mcp).

### Gemini Apps

In Gemini web, open **Settings → Connected Apps → Custom apps**, add the deployed MCP URL, and follow the OAuth prompt. If dynamic client registration is unavailable, the UI has an advanced path to enter client credentials. Google currently documents eligibility limits (personal Google Account, US, English, Keep Activity enabled); these can change and must be checked at setup time. Review the permission request and tool list before connecting. [Gemini custom apps guide](https://support.google.com/gemini/answer/17209137).

### Gemini CLI

The CLI supports remote MCP configuration and OAuth authentication. Once the endpoint's OAuth issuer and scopes are verified, add a remote server through the supported `gemini mcp add` command or `settings.json` `mcpServers` entry, then run `/mcp auth samvev` and `/mcp list`. The local source includes inert monitor-draft creation, grocery/dinner and school-plan writes, restricted message create/edit/withdraw, profile-only updates and minimal granted-display listing. Client approval behavior and live Samvev interoperability remain untested. Do not invent issuer or endpoint metadata: use auto-discovery if supported, otherwise copy exact values from Samvev's deployed operator documentation. [Gemini CLI MCP guide](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md).

### Other clients

Use the client's official remote Streamable HTTP and OAuth instructions. Check endpoint URL, advertised OAuth metadata, exact callback rules, requested scopes, access-token audience and refresh behavior. The generic MCP protocol does not guarantee a uniform login or approval interface.

### Daily school-check prompt

Use the [copy-ready prompt](MCP_DAILY_SCHOOL_PROMPT.md) only with the exact approved class, source, and person IDs selected privately for the current OAuth grant. The prompt does not establish public connectivity or scheduled-client write support.

## Samvev PDF boundary for clients

The local `school.plans.verify_pdf` tool fetches/stores a bounded snapshot and returns verification metadata, not the PDF bytes or extracted text. The member/paired-display school-week UI can open the protected snapshot in the browser and offers download fallback; those UI routes do not make the file readable to an MCP client. If a client cannot read exact source content, it must not infer school-plan meaning from a PDF hash or successful fetch.

## Scheduled invocation

MCP compatibility documents how a client discovers and calls tools. It does not prove that a client's scheduled task feature retains authorization, asks for approvals at the scheduled time, or invokes MCP tools without an interactive session. Treat scheduled runs as unknown until each named client and account configuration has been tested. Specifically, do not claim ChatGPT scheduled MCP writes are supported. Samvev's durable schedules remain owned by Samvev's scheduler; an AI conversation is not the scheduler of record.

## Troubleshooting and access removal

- **Endpoint cannot be reached:** verify that deployment is live, TLS is valid, the URL is exactly the published MCP path, and the endpoint is reachable from the client provider's network. Local-only/private endpoints may need a supported tunnel; do not weaken server access controls.
- **OAuth login fails:** inspect the deployed OAuth metadata and client discovery settings; compare issuer, authorization/token endpoints, redirect URI, requested scopes and resource/audience. Re-enter through the client login flow rather than pasting bearer tokens into prompts or shared configuration.
- **Tools absent or stale:** refresh/rescan the app in the client, inspect the server's current tool list, then re-check the published/allowed action set. Clients may cache tool schemas.
- **Expired session or repeated prompt:** authenticate again in the client. Persistent access depends on the server issuing supported refresh tokens and client behavior; it must be verified live.
- **Revoke access:** disable/remove the connector in the client and revoke the Samvev connection/grant in Samvev's account/security controls. Client-side removal may only delete local configuration and cached tokens; it is not proof of server-side revocation. If tokens may be exposed, revoke them at the server before attempting further calls.

Client-specific checks from the official guides:

| Client | Check |
|---|---|
| ChatGPT | Confirm the account/workspace allows custom MCP apps, complete OAuth before scanning tools, and ask a workspace admin to publish if required. If reconnecting repeatedly, verify refresh-token support in OAuth metadata. |
| Codex | Run `codex mcp list`; rerun `codex mcp login samvev`. For headless terminals use `--no-browser` and follow its loopback callback instructions exactly. |
| Claude web/Desktop | Check connector availability for the plan and organization. A remote connector request comes from Anthropic cloud and needs public HTTPS on port 443; local-only reachability will not work. |
| Claude Code | Run `claude mcp list`, `claude mcp get samvev`, or `/mcp`. Use `/mcp` to authenticate. To revoke, `claude mcp logout samvev` before `claude mcp remove samvev` where supported. |
| Gemini Apps | Confirm Google account/region/language eligibility and Keep Activity. If registration is not dynamic, use the **Advanced features** credentials fields. Review and reauthorize in Connected Apps. |
| Gemini CLI | Run `/mcp list` to see connection errors and `/mcp auth samvev` to authenticate again. Confirm the server `url`/`httpUrl` uses a transport supported by the CLI. |

## Evidence labels

- **Documented support**: the linked product or protocol documentation describes MCP connectivity.
- **Tested with Samvev**: none as of this snapshot.
- **Scheduled-run support**: unknown for every listed client in the Samvev configuration.
