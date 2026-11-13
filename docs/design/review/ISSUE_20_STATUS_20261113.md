# GitHub issue review and calendar cleanup — 2026-11-13

## Public version and scope

`https://samvev.pabben.org/` runs source/deploy `079abc88b0152d04e2cb24656b4ebb9eb8092ecb` on schema 48. It descends from the previously deployed, locally held `92ac58bebe09565b8130fb46ebd18c7608b8cf7a` and preserves its native Home Assistant changes. The prior image is retained for code-only rollback. This review commit contains documentation and five synthetic screenshots; the deployed application source remains `079abc88`.

Issue #20 now submits a confirmed set of disconnected calendars in sequential groups of at most 12, matching the server contract. Each request uses the originally confirmed revision. A connection reactivated or changed during the operation is not deleted. On partial success, the dialog reports how many were removed, refreshes the authorized list, drops stale entries and offers an explicit continuation for unchanged disconnected entries. A permission downgrade removes inaccessible names from the dialog. The existing server checks and deletion boundary remain unchanged. Issue #18's collapsed appearance row now names its purpose; issue #19's Spond and Home Assistant marks no longer overlap text.

## Verification

| Control | Result | Environment |
| --- | --- | --- |
| Focused calendar removal tests | 2/2 PASS | Isolated local Docker test runner |
| Complete workspace tests | 772/772 PASS: web 263, contracts 7, core 3, API 499 | `samvev-m1` test profile, `samvev_test`, schema 48, no exposed test ports. Runner report lacks a retained numeric shell exit marker; test summaries show zero failures. |
| Workspace TypeScript check | PASS, exit 0 | Local Docker test runner |
| Browser GUI/UX proof | PASS, exit 0; 48/48 hash-checked captures on clean source `079abc88` | Disposable synthetic database, six fictitious people, local Chromium. Covers 14 disconnected connections, 12+2 requests, a reactivated connection, safe continuation, keyboard access, display permissions and light/dark layouts. |
| Security, requirements, UX reviews | PASS | Read-only project agents; UX opened the actual images. |
| Release gate | PASS for controlled schema-48 code-only rollout | Read-only gate; private rollout script defect corrected before deployment. |
| Public preflight and restore | PASS | Fresh backup, isolated restore, schema/data checks, candidate and saved rollback-image health. |
| Public cutover and postrestore | PASS | App and worker healthy on `079abc88`; database remained schema 48. Second backup and isolated restore tested the saved `92ac58b` rollback image separately. |
| Public HTTPS smoke | 11/11 PASS, 15/15 served asset hashes | Real synthetic account form login, navigation, reload, logout and access boundaries over `https://samvev.pabben.org/`. No content mutation. |

The five selected, publishable screenshots and their SHA-256 values are in [the issue visual manifest](issue-20-20261113/manifest.json). They show the Integrations and Display settings surfaces in desktop/mobile and light/dark states. The full 48-image proof remains in the ignored local test area. All captures use synthetic data. Browser emulation is not a physical fridge, iPad or Windows Chrome test.

## Issue disposition

| Issue | Status after this review | Evidence or remaining check |
| --- | --- | --- |
| #15 | Ready to close | Compact calendar and durable person colors have existing tests and public UI coverage. |
| #17 | Ready to close | Same-ID display re-pair and revocation are covered by the disposable paired-browser proof; physical hardware is tracked in #12. |
| #18 | Ready to close | Appearance, explicit all/off birthday policy with safe legacy mode, and both person selectors are implemented and tested. |
| #19 | Ready to close | Bundled provider assets, provenance, and new inspected light/dark/mobile screenshots. |
| #20 | Ready to close | Browser and API tests prove single/bulk removal, 12-entry chunking, revision fencing and partial-failure recovery. |
| #21 | Ready to close | Local-date-to-Sunday week behavior has existing tests and public navigation coverage. |
| #3 | Open | Open native theme-select contrast in Chrome on Windows has not been checked on that exact platform. |
| #12 | Open | Physical Shelly/iPad verification remains an owner device check. |
| #13 | Open | Claude adapter is synthetically tested; an owner key and explicitly authorized real provider test are still needed. |
| #14 | Open | ICS flow is implemented; a private owner subscription has not been live-validated. |
| #16 | Open | Webcal/FotMob and large-ICS paths have synthetic coverage; the reported private failing calendar has not been available for a controlled owner test. |
| #22 | Open | Independent prospect comparison and final visual signoff for the entire board remain separate from this issue cleanup. |
| #24 | Open | A descendant of the requested source is public and backed up, but the requested physical portrait-display check has not been performed here. |
| #29 | Open | All-day label and portrait browser work are public; physical fridge validation and the requested comparative acceptance remain separately unverified. |

## Preservation and rollback

No real calendar was removed for testing. No external provider, AI task, physical HA device or family message was changed. Public `.env`, database volume, vault, household data, schedules and LAN demo were preserved. The `079abc88` commit adds no migration; public schema 48 came from already deployed `92ac58b`. The pre-cutover and quiescent backups remain private on the public host. To reverse this code-only change, use the saved Compose override and `92ac58b` image, after checking current runtime and database state. This returns the previous app and worker code; it does not undo any calendar deletions a user may later perform through the new UI.

No secret, private household content or real calendar URL was added to Git.
