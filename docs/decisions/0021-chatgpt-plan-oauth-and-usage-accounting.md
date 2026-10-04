# ADR 0021: ChatGPT plan OAuth and usage accounting

Accepted for the M3 preview, 2026-10-04.

Samvev may use the documented ChatGPT agent OAuth flow as a distinct AI route.
Authorization starts in a local browser companion on `127.0.0.1`, uses state,
nonce and PKCE, and receives an issued client ID. Samvev validates signed ID and
access tokens against the documented issuer, audience, client, subject, expiry
and granted scopes. Browser cookies and manually pasted LAN tokens are outside
the design.

Credential records cross the machine boundary only through an operator-chosen
SSH/SCP path with mode `0600`, then enter a server-side CLI. Each registration is
bound to a household, owner account, membership, verified issuer/subject and
issued client ID. The encrypted vault uses registration-specific associated
data. Rotating refresh is serialized in PostgreSQL. Reauthorization, usage
limits, plan ineligibility and disconnects stop dispatch without automatic
fallback. The companion accepts the VM's validated `urn:uuid` host identity so
later authorization is tied to the stable server identity rather than whichever
laptop opens the browser. Retrying a limit or eligibility block is an explicit,
audited owner action.

The provider uses the public Responses surface with `stream: true` and
`store: false`. Tools are an explicit `samvev` namespace. Only a completed
terminal response can publish. Authorization and the selected registration are
checked immediately before every HTTP dispatch and again before durable monitor
publication. A recurring task records the provider, registration generation and
task revision that the owner explicitly approved; older tasks do not acquire a
ChatGPT charge path merely because household settings changed.

Usage attempts are written before the transport call with a stable attempt ID.
Preflight rejection, started/unknown, completed, failed and interrupted outcomes
remain distinct. Token categories are nullable and reasoning is a subset of
output, never an added charge. Immutable rate snapshots preserve the exact
route, model, context variant, unit, observation date and source used for an
estimate. ChatGPT credits and OpenAI API USD are separate scenarios; Samvev does
not invent a USD value per credit or an account balance.

Migration `019_round5_ai_connections_and_avatars.sql` is additive. A code
rollback can leave its registrations, attempt ledger and snapshots in place.
Operational rollback disables the ChatGPT route, drains in-flight monitor work,
and reverts application code while preserving the schema, encrypted registration
records, attempt ledger and append-only rate history.
