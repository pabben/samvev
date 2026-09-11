# ADR 0015: Provider-independent AI web tools

- Status: Accepted
- Date: 2026-09-10

## Decision

Samvev owns every network operation used by an AI task. Providers receive a
provider-neutral conversation contract containing strict tool definitions,
normalized tool calls and tool results. Provider adapters translate that
contract to their wire protocol; monitor and scheduler code do not depend on
OpenAI, Ollama or another provider format.

The first registered tool is `web.open`. It can open the task's approved public
root URL or an exact same-origin link returned by an earlier call in the same
run. The model cannot supply arbitrary methods, headers, credentials, file
paths, shell commands or previously unseen URLs. Cross-origin links require a
future explicit product decision and are not allowed by this slice.

`web.open` returns a bounded document view with the final URL, content type,
title, headings, normalized text, explicit same-origin links, fingerprint and
fetch time. Source content is untrusted data; instructions embedded in a page
must not change the task or tool policy. The server validates final answers and
events against an exact quote and an actually fetched document. A model may
include that document's URL, but it does not need to reproduce an internal
provenance identifier or exact canonical URL. When the URL is omitted, Samvev
deterministically selects the first opened document that supports both the quote
and claim, then stores its canonical final URL. A supplied URL must still name an
opened document. The server also accepts the exact requested URL from the same
successful `web.open` record when a validated redirect produced a different
final URL, then normalizes it to that final URL. Invented or merely listed link
URLs fail closed.

The agent loop permits at most six tool executions across seven provider turns.
It validates the complete returned call batch before any network side effect,
deduplicates fetched URLs, caps each result and aggregate tool content, and uses
one 180-second execution deadline below the four-minute task lease. Source-based
analysis requires at least one successful tool call; a provider that returns a
premature final answer is asked again within the same bounded session.
Interpretation, Test now, Run now, smarter preview and scheduled worker runs use
this same runner.

Setup interpretation may initially complete without source context because many
requests need only a durable rule. If that response has an invalid setup schema
or claims source access is unavailable, Samvev performs one bounded repair in a
new provider session that requires `web.open`. Both attempts share one
180-second deadline and their sanitized provider/tool counts are aggregated.
The repair is allowed only after a tool-less first response; its remaining
budget is six provider turns and six tool executions, so the complete setup
request still cannot exceed seven provider turns or six tool executions.
Persistent schema failure and source-access refusal remain distinct normalized
errors. No provider switch or paid fallback occurs.

Each `web.open` response is capped at 16 KiB, including at most 8 KiB of
normalized document text plus separately bounded title, headings and ranked
same-origin links. The aggregate tool context is capped at 96 KiB. These limits
keep local-model latency predictable while preserving link discovery and exact
source provenance.

“First headline” means the first editorial heading in extracted document order,
excluding the page title, navigation and section labels. Headings preserve that
order; the separately returned link list is relevance-ranked and cannot be used
as page order. Final evidence is validated only against the exact bounded title,
headings, link labels and text serialized for the model. Full fetched content is
retained separately for fingerprint and dependency refresh and cannot make an
off-window claim pass evidence validation.

Model-facing result parsing permits `confidence` and `uncertainty` to be absent.
Samvev conservatively normalizes those omissions to confidence `0` and a null
uncertainty note before enforcing the existing strict stored/public schema.
Wrong types, out-of-range confidence and extra fields remain invalid. This
normalization does not alter the exact source-evidence requirements.

The OpenAI-compatible adapter maps Chat Completions function tools and tool
messages. The OpenAI adapter maps Responses function calls and outputs. When an
upstream response includes explanatory assistant content together with valid
tool calls, the adapter treats that content as intermediary and emits a tool
turn. It does not reject an otherwise valid call or treat the intermediary text
as a final answer. Internal
tool names are converted to deterministic request-local aliases that satisfy the
provider wire-name grammar, then mapped back before monitor or audit code sees
them. Unknown aliases and alias collisions fail closed. With `store: false`,
opaque encrypted reasoning continuation remains only in the short-lived adapter
session and is never stored or logged. OpenAI-compatible DNS resolution, HTTP
transport and response-body parsing share one provider timeout budget when no
outer monitor deadline is supplied.

The caller owns the provider session lifetime explicitly. A premature final
answer can therefore be retried with the same cancellation signal when a source
tool was required. The runner closes the session once after the complete loop;
one-shot calls close it in `finally`. Protocol-invalid or provider-failed
sessions become terminal, and later turns cannot reach transport.

## Source state and audit

A successful production run stores a dependency manifest for every document
used. Later scheduled or manual production checks refresh that manifest with
ordinary code before AI runs. If every dependency is unchanged, Samvev records
the check and makes zero provider calls. Test and smarter previews never replace
the production manifest or schedule.

Migration `012_monitor_agent_tools.sql` additively stores dependency manifests,
the actual provider-turn count and compact provenance on monitor runs, plus a
tool-audit table. Successful provenance contains source URL, content type,
fingerprint, fetch time and optional HTTP status/response byte count. A failed
attempt records only the allowlisted tool,
a URL that passed syntactic and credential checks, the outcome and a normalized
error code. It excludes raw page content, prompts, model output, reasoning,
arbitrary arguments and credentials. Public monitor responses use successful
provenance only and expose just source URL and fetch time.

## Security consequences

Monitor tools use the public-only source policy, not the LAN-permitting local AI
endpoint policy. URL user information and credential-like query parameters,
localhost, private/LAN, link-local, metadata, multicast, unspecified and reserved
targets are blocked. Ordinary non-credential query parameters remain available.
DNS answers are validated and pinned for the request. Every redirect is
validated, and followed links must retain the approved origin. Responses retain
the existing timeout, redirect, MIME, PDF and size limits.

HTML extraction prefers the semantic main document and strips nested navigation,
headers and footers before building a compact model view. Link discovery remains
available through separately bounded same-origin links. DNS pinning supports the
address-list lookup used by current Node runtimes, so validation cannot silently
fall back to an unpinned resolver.

Unknown tools, malformed arguments or call IDs, URLs outside the approved set,
and exhausted step or byte budgets fail closed. Existing household permission,
rate-limit, lease, final-authorization and M1 message-reconciliation checks stay
authoritative.

## Consequences and rollback

The registry can later add weather, calendar, search or integration tools with
their own arguments and authorization without changing ordinary Oppdrag UI.
This ADR does not implement those tools or grant general provider-side network
access.

The schema change is additive. Code can roll back while leaving the added table
and columns unused. A destructive schema rollback would first pause monitor
workers and remove `monitor_tool_audits`, then the three run/task columns only
after retained run history has been reviewed.

The setup-repair and server-anchored provenance follow-up requires no migration.
Rolling back that code restores the earlier setup and evidence behavior while
leaving migration 012 and existing audit rows intact.
