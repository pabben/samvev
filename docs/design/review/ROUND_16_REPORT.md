# Round 16 — final candidate review

## Candidate and publication status

Code source: `000bf7ab03db3f4f34c2da09e20ad18d5a78b027`. Publisher review checkout before this documentation update: `08851d3448e910ae04bcfe9100e0530bf60d13ea`. Canonical visual capture Round ID `20261029232208-000bf7ab-83b5308a`; the 14 PNGs and hash/source manifest are in [`latest/`](latest/). Public test remains on R15 source `05cf86dc83ab70070b7050b2c25fa71cff6380bb`. Public test deployment of R16 is already authorized; it remains pending until release checks and backup/restore gates pass. No R16 deployment is claimed yet.

## Verification

- At earlier R16 code checkpoint `b9b7b8ea4aa52779295288c919b30eaa4611d753`, isolated suites passed: API **437/437**, contracts **7/7**, core **3/3**. Backend source was unchanged through final code checkpoint `000bf7ab03db3f4f34c2da09e20ad18d5a78b027`.
- At final code checkpoint `000bf7a`, the isolated Compose `test` service against `test-db/samvev_test` passed web **242/242**. QA was isolated; no household or production data was changed.
- Five workspace checks passed. Final-source host scripts **33/33**, browser privacy check **1/1**, final Home targeted layout **13/13**, and typecheck passed. Protected local logs for the final web, Home and host-script runs are under `.local/m3/round16/qa/`.
- Security re-review passed for preview fencing, access boundaries and preview rate limiting.
- UX final visual review passed for mobile compose and iPad width; the earlier desktop gap was closed. Provider marks were reviewed on mobile, iPad and Shelly-sized viewports in both themes, without overflow. The canonical set has 14 source- and hash-verified images.
- Fridge preview review used a minimal-grant synthetic setup. The rendered projection was short (218px); this does not establish parity with a paired live display. Physical device behavior was not tested.
- The #17 same-ID/grant, old-cookie-revoked and new-cookie-authorized API behavior is synthetically tested; two-browser UI acceptance remains engineering work. Focused #18 keyboard/focus browser acceptance also remains open. These are separate from physical owner tests.

## Safe diagnosis and external state

School task A's latest observed status is `final_schema/schema_mismatch`. School task B's latest is `AI_UPSTREAM_ERROR` after successful tools. Historical raw causes are unavailable. Root-cause diagnosis and any verified software repair remain engineering work; no cause or repair is established. No live task mutation, new model call, approval/schedule/history change is claimed.

Public read-only status showed successful HA calendar sync at 2026-10-29 21:35 UTC; the older TLS blocker is stale. Kjøleskap showed 14 cards, six profiles/birthdays, zero source display targets, board read grants false and zero HA control entities. No automatic sharing is inferred. No real names or private household content were added; no user data was changed.

Issue #19 assets are included as local official marks, with owner authorization and provenance recorded in `apps/web/src/assets/calendar-providers/PROVENANCE.md` (asset change commit `30e8075`). No external image requests are made.

## Remaining actions

See [Round 16 owner actions](ROUND_16_OWNER_ACTIONS.md) for consent/private-source/device checks. R16 deployment is authorized and pending release checks plus backup/restore gates; this report does not represent publication.
