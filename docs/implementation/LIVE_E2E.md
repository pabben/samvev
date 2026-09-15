# Synthetic deployed-runtime E2E

`bash scripts/live-e2e.sh run` tests the actual configured runtime through ordinary login,
monitor and diagnostic APIs and a real browser. It does not require an owner's
credentials. Do not use it until the supported registration/evidence endpoints
and migration 015 are deployed through a separate authorized gate.

## One-time operator setup

1. Review and deploy the infrastructure candidate as immutable app/worker images.
   Keep only one worker per database. Apply migrations
   `015_live_e2e_registration.sql` and
   `016_monitor_failure_diagnostics.sql` using the normal migration runner and
   backup gate. Migration 014 and existing data stay intact. Migration 016 stores
   only bounded provenance/dependency metadata and allowlisted validation reason
   tokens for failed runs; it does not store provider output or source content.
2. Enable `SAMVEV_LIVE_E2E_ENABLED=true` only in the intended runtime. It enables
   the registered diagnostic API and a rate-limited public, non-personal
   weekly-plan fixture.
3. Build/publish the exact candidate as immutable runtime and browser images.
   Execute `bash scripts/live-e2e.sh provision` in the intended operator
   environment using that runtime's normal Compose DB/secret configuration.
   It requires `SAMVEV_E2E_RUNTIME_IMAGE` to be an immutable image digest and
   uses the fixed ignored destination
   `.local/live-e2e/credentials/credentials.json` on the host. Both provisioner
   and browser use the absolute container path
   `/workspace/.local/live-e2e/credentials/credentials.json`; AI settings use
   `/workspace/.local/live-e2e/ai-settings.json`. The wrapper passes these absolute
   paths because `npm --workspace @samvev/api` changes its working directory to
   `/workspace/services/api`. Do not pass a relative `.local/...` path to that
   workspace command. The provisioning command
   creates a synthetic household/account, hashes the generated password, emits
   only registration identifiers, and creates no session. Keep the file mode
   0600; repeating the command with the same file validates the binding rather
   than creating another identity. A missing credential file for an existing
   registration is an operator recovery condition, not permission to replace it.
   The account keeps the household-administrator UI role label but receives only
   the four capabilities required for household monitor tests. Provisioning an
   older registered test identity once more reduces its capabilities to this exact
   set and records that change in the audit log.
4. Create `.local/live-e2e/ai-settings.json`, mode 0600, for synthetic AI
   settings. Use the normal settings payload keys: `enabled` (true), `provider`
   (`openai_compatible`), `baseUrl`, `defaultModel`, `strongModel`, optional
   `defaultReasoningEffort`, `strongReasoningEffort`, and optional `apiKey`.
   Omit `expectedRevision`; the harness reads the synthetic settings revision.
   A local endpoint that needs no key may use `apiKey: null`. Supply only this
   test household's approved configuration. Never copy data from a real
   household. No concrete endpoint/model/credential belongs in these docs.

The runner uses a separately built immutable browser image on the isolated
`samvev-m1-live-e2e-egress` network. It does not share the app/worker/database
network and has no database connection. Credentials and AI settings are mounted
read-only as separate files; only `.local/live-e2e/reports` is writable. Do not
add test mounts to live app or worker. Docker resources must belong to
`samvev-m1`.

## Permanent command

Set the following environment variables without printing the secret JSON files:

```sh
SAMVEV_E2E_ORIGIN=https://your-authorized-runtime.example
SAMVEV_E2E_CONFIRM_ORIGIN=https://your-authorized-runtime.example
SAMVEV_E2E_RUNTIME_IMAGE=registry.example/samvev@sha256:REPLACE_WITH_RUNTIME_DIGEST
SAMVEV_E2E_HARNESS_IMAGE=registry.example/samvev-browser@sha256:REPLACE_WITH_BROWSER_DIGEST
export SAMVEV_E2E_ORIGIN SAMVEV_E2E_CONFIRM_ORIGIN
export SAMVEV_E2E_RUNTIME_IMAGE SAMVEV_E2E_HARNESS_IMAGE
bash scripts/live-e2e.sh provision
# Create .local/live-e2e/ai-settings.json with mode 0600, then:
bash scripts/live-e2e.sh run
```

The two origins must match exactly. HTTPS is required except loopback HTTP for
isolated development. The weekly-plan source uses that public origin, so its
server-side fetch must pass the ordinary public-source SSRF policy. Do not
allow private/container sources to make this test pass. An isolated QA deployment
may use approved synthetic network fixtures through its existing test injection
mechanism; distinguish that evidence from an external runtime run.

Both secret files must be regular, owned mode-0600 files resolving inside
`.local/live-e2e`; the runner requires the exact `.local/`
rule in the repository `.gitignore`. The operator can additionally verify paths
with host `git check-ignore` before invoking a container runner. No credentials are command-line
arguments. `DEBUG` and `PWDEBUG` are rejected to prevent browser/request debug
logging. Do not enable shell tracing. Browser cookies exist only in memory and
normal logout revokes the session. The harness does not capture traces,
screenshots or storage-state files.

## Matrix and results

- Normal login; exact account/membership/household/registration/marker attestation.
- A browser-driven weather case fills the real create form with an instruction
  and unique name, leaves the optional source empty, chooses only the synthetic
  recipient and submits Create setup. Its first Test now is activated through
  the real button. Those same runs also count toward the repeatability matrix;
  browser coverage does not add extra model runs.
- Populated running and terminal cards are checked for source/result/time and
  available next actions, keyboard focus, Axe and overflow at desktop/mobile
  widths. The runner verifies actual NB/EN and light/dark document attributes,
  spinner animation and its removal under reduced motion. A reload during the
  real running state must retain the same task/run and send no enqueue request.
- That case is deleted using the real Delete button and confirmation. The card
  must disappear immediately and stay absent after reload. API cleanup remains
  a finally-block fallback if a browser assertion fails.
- Weather ×3 and via-Yr ×3 on the same task in each case.
- Synthetic weekly-plan plus weather ×3; relevant condition must return events.
- The same combined sources with a negative threshold ×2; result must contain
  `events: []` and still succeed.
- Every ordinary action enqueues once: HTTP 202, fresh ID after a terminal
  execution, reload/reconnect to the same ID, exact execution evidence,
  required tools, provenance/cache checks and no stale error.
- Deduplication is probed only on the browser-driven weather setup and first
  Test now: after the UI receives 202, the runner reads that persisted run and
  requires queued/running status before sending one representative duplicate.
  The duplicate must return the same ID. The other repeatability actions are
  not doubled, preserving the normal rate-limit budget.
- Every test: draft remains unapproved, no scheduled check and zero emitted
  messages. No real display or notification destination is used.
- Finally: wait for active work, normal DELETE, verify absence and logout.

The runner prints a sanitized PASS/FAIL matrix and timing. It exits nonzero for
any failure, including cleanup. Detailed reports live under
`<repository>/.local/live-e2e/reports/<invocation>/report.json` on the host, mode 0600.
The runner prints its opaque invocation UUID; the wrapper prints the absolute
host report-directory template. Inside the container the same file is
`/workspace/.local/live-e2e/<invocation>/report.json`, because Compose mounts
host `.local/live-e2e/reports` at container `/workspace/.local/live-e2e`. Do not
look for a second nested `reports` directory inside that container mount.
Reports contain no passwords, API keys, model names, raw result text or cookies. Opaque task IDs are retained
only for cleanup residue; execution IDs printed to the console are hashed.

A transient observation/network failure does not cancel the server job or claim
`AI_TIMEOUT`. The observer has a 750-second bounded wait; server bounds remain
300/600/180 seconds according to the existing policy. After an interrupted
runner, inspect its ignored residue manifest and remove only that invocation's
synthetic tasks through authenticated product APIs once terminal. Never delete
records directly in the database. A second invocation must use a new UUID and
must not silently remove the previous invocation's tasks.

## Local checks and current evidence

```sh
npm run test:e2e-harness
```

The helper suite covers origin confirmation, identity/marker mismatch, multiple
memberships, sensitive-output redaction, partial cleanup and exact execution
provenance/cache checks with synthetic fixtures. Existing provider, execution,
monitor and browser suites remain required. External services are supplemental,
never the only automated source of truth.

Current helper test result: **10/10 PASS**, executed using
`docker compose -p samvev-m1 --profile browser run --rm --no-deps browser node --test tests/e2e/live-runtime.test.mjs`.
The isolated QA runtime has completed the actual configured local-model matrix:
weather 3/3, «via yr» 3/3, public-reference `web.open + weather.forecast` 3/3,
and negative `events: []` 2/2. Reconnect, active-run deduplication,
execution-scoped provenance, no-message checks, DELETE, cleanup and logout all
passed. This proves the candidate path with a real provider. It does not claim
live PASS because the currently deployed image does not yet include migrations
015–016 or these supported routes.

The observed combined run times were 484.6 s, 118.2 s and 125.0 s. The slowest
run remained inside the unchanged 600 s local-complex server deadline. Weather
runs completed in 73.7–86.6 s and «via yr» in 75.1–84.7 s after setup. Tool and
location/network work remained below 1.2 s per observed run; local inference
accounted for nearly all elapsed time.

Technical PASS can be established by automation. Owner review remains for visual
quality, understandable wording and whether the result is actually useful.

The shared browser driver regression passed against the actual frontend with
fully intercepted synthetic APIs: form create/setup, Test now, same-run reload,
progress-stage transition, terminal result/source/time, NB/EN/light/dark,
mobile/desktop populated Axe/overflow, reduced motion, keyboard/focus and UI
delete/confirmation/reload. This is driver-validation evidence, not live E2E
PASS; no actual backend session, model or source was used in that regression.

`test:e2e-harness` runs both helper tests and the shared UI browser smoke. Its
sixth helper test checks one enqueue per ordinary action, an observed active
execution before the representative duplicate, and rejection of terminal or
mismatched duplicate probes.

The operator-path regression executes only the wrapper’s static path declarations,
checks resolution from both repository and API-workspace directories, and verifies
that provisioner and read-only browser mounts agree. It does not provision an
account or access any credential file.

The shared navigation driver waits up to 15 seconds for the Oppdrag/Tasks
heading after keyboard activation; panel fetching is asynchronous. Its browser
regression holds the initial monitor-list response, verifies that navigation
remains pending with no heading, then releases it and requires the visible
heading. This observation bound does not modify durable-run timeouts.

## Isolated QA: optional public source supplement

The repeatability prompts use the verified municipality-qualified place
`Birkeland, Birkenes`. `Birkeland, Agder` can match multiple municipalities;
that is correct location ambiguity, not a product failure to suppress.

The default deployed-runtime combined source remains
`${SAMVEV_E2E_ORIGIN}/api/v1/e2e/fixtures/weekly-plan`. A loopback-only QA origin
is intentionally blocked by the server's public-source SSRF policy. For a
supplemental actual local-model tool-loop pilot, the operator may set and export
`SAMVEV_E2E_PUBLIC_SOURCE_URL` to an approved, non-personal public HTTPS page
before `bash scripts/live-e2e.sh run`. Supply it through the operator environment;
it is separate from AI settings and credential files. Do not commit the actual
URL or put access tokens in it. The wrapper passes it to the browser container.

The harness rejects credentials, fragments, whitespace, IP literals and obvious
localhost/internal/metadata targets before login. It does not print the URL or
its query. The server still validates DNS, redirects, MIME, size and all normal
source restrictions; the override does not bypass or alter that policy.

Reports explicitly identify `sourceMode: public_supplement` when overridden,
or `synthetic_weekly_plan` by default. In supplement mode the combined prompt
asks the model to read the approved public reference without inventing
activities, then evaluate the explicit weather threshold. This establishes
actual local-model multi-tool execution, not a deterministic school-plan
semantic result. The synthetic weekly-plan fixtures in CI and the deployed
runtime fixture remain the authoritative positive/negative plan+weather semantic
checks. The isolated actual-model pilot used a public supplement because
weakening the loopback SSRF guard would invalidate the security test; its
threshold cases supplement rather than replace the deterministic synthetic
tests.

## Focused diagnostic scenario selection

For isolated diagnosis, set `SAMVEV_E2E_SCENARIOS=web+weather` before the supported
wrapper command. Allowed case names are exactly `weather`, `via-yr`,
`web+weather`, and `negative`, separated by commas with no duplicates or spaces.
Omit or leave the variable empty for the full default 3/3/3/2 matrix. A selected
case keeps its normal repeat count; this does not shorten a run or change any
server policy. Invalid selectors fail before login or mutation.

The report and initial console line include the selected cases and
`completeMatrix:false` whenever any case is excluded. A successful filtered run
prints `LIVE E2E DIAGNOSTIC COMPLETE (not full release evidence)` and can never
print `LIVE E2E PASS`. A full matrix using an external public-source supplement
is also labelled diagnostic, because its source semantics do not replace the
synthetic weekly-plan gate. Only the full matrix with the default synthetic
source can report overall LIVE E2E PASS.

Failed setup interpretation and Test now results preserve only the backend's
allowlisted `validationStage` and `validationReason`, plus the already sanitized
execution ID, error code and timing. They are written before cleanup. Unknown
diagnostic strings and all other error details, prompts, reasoning, model
output, source queries and secrets are discarded. A secondary evidence-endpoint
error does not erase an already observed terminal validation diagnostic.
