# M3 Family Hub — local completion status

Branch: `feat/m3-family-hub`. Implementation, visual refinement and full local QA
are complete. **Independent release gate: PASS at `80d0df0` (2026-09-25), no
blocking findings.** The final documentation commit only records that result. No PR, push,
merge, tag, release, deployment, immutable release build or Actions run occurred.

## Implemented architecture and behavior

[ADR 0020](../decisions/0020-external-intelligence-family-hub.md) retains
Fastify/PostgreSQL/React and existing realtime infrastructure. External items are
separate from human messages and their render acknowledgments.

- Additive migrations 017–018 provide stable connections, hashed revocable
  credentials, items, person/display targets, display grants and producer locale.
  Existing migrations were not rewritten.
- The [API](M3_API.md) supports reminder, alert, event, summary, list and observation.
  Strict envelopes preserve sources, observed/generated timestamps, uncertainty
  and contentLocale en/nb. Legacy unknown language stays NULL; no translation or
  locale-based hiding is implied.
- Bearer credentials are household/connection scoped with independent read,
  write and delete capabilities, one-time reveal, expiry, revocation, audit and
  IP/credential/connection rate limits. Administration requires session/CSRF and
  server-side household.manage authorization.
- Connection + externalId survives token rotation. Canonical retries do not
  duplicate or increment revisions; material updates require the current revision.
  Withdrawal leaves a permanent non-resurrectable tombstone.
- Primary Home contains dynamic person columns, event-time Today/Tomorrow timeline,
  Important, summaries, structured lists and family messages. Full text and
  provenance remain available through accessible dialogs.
- Child permissions, targeting and household isolation are enforced server-side.
  Display publication requires item targeting, connection grant and display opt-in.
  Privacy mode clears content; URLs and unrelated people are stripped from display
  projections.
- POST → PostgreSQL → SSE invalidation → authorized member/display refetch works
  without reload. Polling recovers missed notifications. Offline item expiry and
  the existing maximum 15-minute authorization-cache deadline remain enforced.
  Human-message render ACK is preserved.
- AI Oppdrag remains secondary/experimental under More. No direct external-data
  adapter or fake device control was introduced.

## Design and evidence

The authoritative light reference (23_51_09.png) informs warm surfaces, pastel
person cards, rounded cards and mobile feed. The dark reference (23_52_06 (4).png)
informs navy glass surfaces, layered background, Today/Tomorrow and the broad
family-message area. Shared semantic CSS tokens and system fonts implement one
application with light/dark/system modes.

[15 committed screenshots and iteration notes](artifacts/m3/README.md) cover
390×844, 1920×1080, 1280×752, iPad portrait/landscape, both themes, full-page views
and eight-person stress. Final independent QA reproduced all 15 under the ignored
`.local/m3/final-m3/`. Coordinator and UX reviewer actually viewed screenshots.

Actual refinements reduced oversized header/hero, placed Important beside the
agenda, enlarged useful TV text, moved detailed provenance into dialogs and
raised the family-message band. Mobile presents both Important cards initially.
Secondary content scrolls without clipping. Axe, landmarks, keyboard/dialog focus,
reduced motion and responsive touch layouts were exercised.

## Final verification

See [M3_QA_REPORT.md](M3_QA_REPORT.md) for commands, logs and detailed scope.

| Check | Result |
| --- | --- |
| Workspace tests | 182 pass, zero failed/skipped: web22, contracts5, core3, API152 |
| Typecheck/build | Pass in Node24 project containers |
| Lint | Dispatcher exits0; no workspace linter is configured |
| Legacy browser | Smoke16, review10, UX10 pass |
| E2E harness | 10 unit tests plus synthetic intercepted browser flow pass |
| M3 real API/browser | 10 groups, 15 screenshots, no page errors; viewport/theme Axe |
| Database | Fresh001–018/rerun; 016→017 preserves legacy messages; populated017→018 preserves item with unknown locale |
| Security | Four findings fixed; independent re-review PASS; expanded child/scope/rotation/revocation/SSE tests pass |
| Requirements/UX | PASS after locale addition and screenshot-based refinements |
| Independent final gate | PASS: 9 focused tests independently rerun, read-only SQL/health/Docker inspection and six final screenshots reviewed |

The coordinator independently checked final logs/counts, migration ledger and
preserved-data evidence, DCO sign-offs, branch/worktree and actual screenshots.
The old 2026-09-07 pixel comparator remains unchanged and unrun because its visual
direction is superseded by the user's M3 references. No thresholds or old baselines
were weakened. Worker has zero standalone unit tests; its lifecycle was exercised
by API and actual browser scheduling tests.

## Local commits and changed files

All checkpoints use DCO sign-off:

- bae2ac1: external intelligence backend/contract/migration017.
- 16e897d: responsive Home, themes and integration administration.
- 10d7379: real browser/visual coverage.
- 10ae27c: architecture/API and synthetic HA handoff documentation.
- 02ec309: security hardening and content-language migration018.
- 16cac35: producer-language declaration and lost-access clearing.
- 175a20b: unavailable administrator-role UI guard.
- 1a32cdf: expanded API isolation and full regression QA.
- 80d0df0: complete local QA/status documentation; independently gated code state.
- Final documentation checkpoint: records the gate PASS without code changes.

Changed areas: services/api source and migrations017–018; packages/contracts;
packages/design-tokens/tokens.css; apps/web Home/member/display/integration/person
controls and NB/EN locales; API/web/E2E tests; architecture/product/ADR/status/API/QA
documents; integrations/home-assistant; M3 screenshots. Exact file inventory:
`git diff --name-only 7ae7b4c..HEAD`.

Only pre-existing .npmrc edits and the empty untracked database file remain outside
commits. They were preserved. No real household/child/location data, production
credentials or private source data was introduced. Fixtures and QA credentials
are synthetic.

## Handoff, limits and rollback

[Synthetic JSON](../../integrations/home-assistant/synthetic-family-brief.json),
[manual illustrative HA YAML](../../integrations/home-assistant/synthetic-family-brief.yaml)
and API curl example document tomorrow's family brief. A deterministic producer
must validate model output, targets, provenance and stable identity before ingress.
Actual compatibility is unvalidated in [M3-HA-001](../backlog/M3_INTEGRATION_VALIDATION.md).
Nothing contacted real HA, OpenAI, Homey, calendar, weather or push services.

Stop ingress before rolling app/worker code back together. Retain additive
schema and tombstones; use a verified pre-migration backup for a full DB rollback.
No destructive down migration exists. Withdrawn payload retention needs a future
policy; M3 retains tombstones. Offline revocation remains bounded by 15 minutes.

Rounded disk measurements: filesystem used 15 GiB at initial inspection → 26 GiB after
local Docker/browser/test setup; available 77 → 67 GiB. Repository 47 → 89 MiB including
ignored evidence. These are filesystem measurements, not exclusive Docker layer
accounting. Only samvev-m1 Docker resources were operated. Accidentally started
regular dev app/worker/db were stopped; isolated QA/test and synthetic legacy
services remain locally available.

Physical Shelly/touch/distance readability and subjective preference for the
restrained abstract background/system fonts/initials versus more photographic
reference styling remain for owner review. Mobile places person cards before the
longer agenda; that is a presentation preference, not missing content.

Before PR/release: explicit instruction, owner design feedback and diff review,
a versioned M3 visual baseline where appropriate, then environment-specific
release/backup/security checks. Real integrations and physical hardware validation
are separate follow-ups. Local completion does not authorize production actions.
