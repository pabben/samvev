# Round 16 — final candidate review

## Candidate and publication status

Code and public test deployment source: `000bf7ab03db3f4f34c2da09e20ad18d5a78b027`. Immutable public app/worker image: `sha256:53f18fd919f7e02ec4e9a725fe85560fbbdddcad2e1498e1363fa0c7aec5cdc5`. Canonical visual capture Round ID `20261029232208-000bf7ab-83b5308a`; the 14 PNGs and hash/source manifest are in [`latest/`](latest/). Public test cutover completed on 2026-10-30 UTC; app, worker and database were healthy and retained schema 001–045. This is a scoped R16 publication, not completion of the cumulative product goal.

## Verification

- At earlier R16 code checkpoint `b9b7b8ea4aa52779295288c919b30eaa4611d753`, isolated suites passed: API **437/437**, contracts **7/7**, core **3/3**. Backend source was unchanged through final code checkpoint `000bf7ab03db3f4f34c2da09e20ad18d5a78b027`.
- At final code checkpoint `000bf7a`, the isolated Compose `test` service against `test-db/samvev_test` passed web **242/242**. QA was isolated; no household or production data was changed.
- Five workspace checks passed. Final-source host scripts **33/33**, browser privacy check **1/1**, final Home targeted layout **13/13**, and typecheck passed. Protected local logs for the final web, Home and host-script runs are under `.local/m3/round16/qa/`.
- Security re-review passed for preview fencing, access boundaries and preview rate limiting.
- UX final visual review passed for mobile compose and iPad width; the earlier desktop gap was closed. Provider marks were reviewed on mobile, iPad and Shelly-sized viewports in both themes, without overflow. The canonical set has 14 source- and hash-verified images.
- Fridge preview review used a minimal-grant synthetic setup. The rendered projection was short (218px); this does not establish parity with a paired live display. Physical device behavior was not tested.
- A later local test-only six-person synthetic preview fixture at `82d2960` passed **9/9** in the isolated Compose `test` service. It asserts one semantic person card per ID, no duplicated explicit Today card, no unshared grocery content, and disabled preview actions. It uses the live `FamilyHub` renderer but does not compare the stateful paired `Display` projection assembly; live parity remains open.
- The #17 same-ID/grant, old-cookie-revoked and new-cookie-authorized API behavior was synthetically tested before the focused browser acceptance below. Physical target-screen validation remains a separate owner check.
- A later focused synthetic Playwright run in the local `qa-browser` service passed with two isolated browser contexts: admin approval and an initially unpaired display redeem used the same display ID; #18 inherited language/theme controls and visible keyboard focus passed. All API requests were intercepted, so server cookie revocation is evidenced separately by `round15-display-policy.integration.test.ts`. This does not yet prove an integrated old-paired/new-paired two-browser flow retaining grants. Browser test source is `tests/e2e/display-repair-keyboard.mjs` at `3fdeb9b`; no database or public display was mutated.
- Public HTTPS smoke passed using the retained protected synthetic credential: anonymous pages, login, direct member navigation/reload, privacy boundaries, asset hashes and logout. The public app and worker image labels independently matched the exact source and both were healthy. Fresh protected pre-cutover and postdeploy backups plus isolated schema-45 restore gates passed. Protected ops evidence is under `.local/m3/round16/ops/000bf7ab03db3f4f34c2da09e20ad18d5a78b027/` on the public host; no secrets or household data are in this report.

## Safe diagnosis and external state

School task A's latest observed status is `final_schema/schema_mismatch`. School task B's latest is `AI_UPSTREAM_ERROR` after successful tools. Historical raw causes are unavailable. Root-cause diagnosis and any verified software repair remain engineering work; no cause or repair is established. No live task mutation, new model call, approval/schedule/history change is claimed.

Public read-only status showed successful HA calendar sync at 2026-10-29 21:35 UTC; the older TLS blocker is stale. Kjøleskap showed 14 cards, six profiles/birthdays, zero source display targets, board read grants false and zero HA control entities. No automatic sharing is inferred. No real names or private household content were added; no user data was changed.

Issue #19 assets are included as local official marks, with owner authorization and provenance recorded in `apps/web/src/assets/calendar-providers/PROVENANCE.md` (asset change commit `30e8075`). No external image requests are made.

## Remaining actions

See [Round 16 owner actions](ROUND_16_OWNER_ACTIONS.md) for consent/private-source/device checks. Remaining engineering work includes school A/B root-cause repair, #17 integrated old/new paired-browser acceptance, and a paired live fridge/preview parity check. The latter needs an authorized screen setup with explicit grants; the synthetic minimal-grant preview cannot prove it. No full-goal PASS is claimed.
