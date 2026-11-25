# MCP client compatibility

Status: research snapshot, 2026-11-25. The planned Samvev URL `https://samvev.pabben.org/mcp` is a placeholder for a future deployed endpoint, not a working service. No client has been connected or tested against Samvev. The first proposed tools are read-only. Client support for MCP does not imply support for every Samvev tool, account plan, authentication configuration, or unattended scheduled invocation.

## Client status

| Client | Documented MCP support | What this means for Samvev | Samvev test status / scheduled runs |
|---|---|---|---|
| ChatGPT | OpenAI documents connecting remote custom MCP servers with authentication; availability and write support depend on plan and workspace controls. [Connection guide](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) | A future remote Streamable HTTP endpoint may be connectable after OAuth and workspace requirements are verified. Current Samvev tools are proposed read-only tools. | Not tested with Samvev. No evidence here that scheduled ChatGPT tasks can invoke this server unattended; treat scheduled invocation as unknown. |
| Codex | OpenAI documents MCP configuration in Codex CLI/IDE. [Codex MCP documentation](https://developers.openai.com/codex/mcp/) | A compatible remote HTTP MCP server can be configured where Codex can reach it; authentication details remain to be verified for the eventual endpoint. | Not tested with Samvev. Scheduled/background runs are client- and environment-specific; unknown. |
| Claude (web/Desktop) | Anthropic documents remote MCP connectors for Claude, Cowork, and Claude Desktop; the MCP guide also documents local Desktop servers. [Remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [Desktop/local MCP](https://modelcontextprotocol.io/docs/develop/connect-local-servers) | Compatibility depends on plan/connector availability and matching remote transport/auth. No Samvev connector is published. | Not tested with Samvev. No verified scheduled Samvev tool execution; unknown. |
| Claude Code | Official docs cover remote HTTP and local stdio MCP servers, including OAuth. [Claude Code MCP](https://code.claude.com/docs/en/mcp) | Remote Streamable HTTP is documented; endpoint/auth compatibility still needs a real connection test. | Not tested with Samvev. Scheduled jobs may run in distinct environments and require a separate authenticated connection; unknown. |
| Gemini Apps | Google documents custom MCP connected apps, with eligibility and availability restrictions that may vary by account/region. [Custom apps for Gemini](https://support.google.com/gemini/answer/17209137) | The Google guide describes adding a server URL and credentials where needed. It does not establish Samvev compatibility or availability to every user. | Not tested with Samvev. No evidence that scheduled Gemini tasks can use Samvev without interactive confirmation; unknown. |
| Gemini CLI | Google's official CLI docs describe MCP server configuration and transports. [Gemini CLI MCP](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md) | It can be configured as an MCP client, subject to the eventual server transport and auth. | Not tested with Samvev. Any scheduled command requires a separate configured CLI runtime and auth; unknown. |
| Gemini API / other model APIs | The Gemini API documents function calling; API model tool calls are not themselves proof of an MCP client. [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling) | An application can adapt MCP tools through a client/runtime, but the app must implement the connection and authorization. | Not tested. Scheduled use depends on the application that runs the client; unknown. |
| Generic MCP clients | MCP is a protocol with client/server guidance; each client chooses transports, OAuth behavior, and approval UX. [MCP documentation](https://modelcontextprotocol.io/docs) | Expect compatibility only after validating the actual transport, authentication, scopes, tool schema, and confirmation behavior in that client. | No generic certification or Samvev client test has been performed. Scheduled invocation remains client-specific and unknown. |

## Setup URL placeholder

When a deployed endpoint exists, enter the verified MCP endpoint shown here:

```text
https://samvev.pabben.org/mcp  # planned placeholder; not verified or deployed
```

Do not create credentials or copy secrets into this document. Follow the selected client's official setup flow and grant only the required Samvev access. The exact OAuth discovery URLs, scopes, redirect behavior, and refresh-token behavior must be confirmed against the deployed service before publishing setup instructions.

## Scheduled invocation

MCP compatibility documents how a client discovers and calls tools. It does not prove that a client's scheduled task feature retains authorization, asks for approvals at the scheduled time, or invokes MCP tools without an interactive session. Treat scheduled runs as unknown until each named client and account configuration has been tested. Samvev's durable schedules remain owned by Samvev's scheduler; an AI conversation is not the scheduler of record.

## Evidence labels

- **Documented support**: the linked product or protocol documentation describes MCP connectivity.
- **Tested with Samvev**: none as of this snapshot.
- **Scheduled-run support**: unknown for every listed client in the Samvev configuration.
