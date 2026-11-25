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

The browser companion separately preserves token-free registration metadata
with mode `0600`. It records the issued client ID after the state-checked
callback and later binds that ID and VM host ID to the verified issuer/subject.
An interrupted first token exchange therefore resumes with fresh state, nonce
and PKCE without retaining or requiring an old credential export.

A rotating refresh response is encrypted before network-dependent discovery and
signing-key validation. A transient validation outage moves the registration to
`pending_validation`, blocks all inference and retries only the newest candidate;
it never reuses the rotated-out refresh token. Samvev validates an ID token only
when the refresh response supplies a new one; an older retained ID token is an
identity hint and cannot invalidate a newly signed, correctly bound access
token. A cryptographically invalid
signature, issuer, audience, client, subject or required scope remains terminal
and clears the candidate. Refresh serialization, owner/household authorization,
generation fences and disconnect revocation still apply while validation is
pending.

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

An attempt is priceable only when its immutable snapshot matches the actual
route, model, context variant, service-tier assumption and expected unit, and
contains every required nonnegative rate. Zero rates and zero-use days remain
valid. Owner-bound normal attempts that may have reached transport but retain an
unknown dispatch marker stay in the unknown share and make forecasts
preliminary; they are not promoted to confirmed provider charges. Known
preflight rejection remains proven zero dispatch.

Migrations `019_round5_ai_connections_and_avatars.sql` and
`020_round6_ai_usage_and_oauth_recovery.sql` are additive. A code
rollback can leave its registrations, attempt ledger and snapshots in place.
Operational rollback disables the ChatGPT route, drains in-flight monitor work,
and reverts application code while preserving the schema, encrypted registration
records (including pending validation candidates), attempt ledger and append-only
rate history.
