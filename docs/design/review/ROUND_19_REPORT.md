# Round 19 — family display fit and calendar import clarity

Round ID: `20261119T0814Z-c3ad869`

Source and public test deployment: `c3ad869e207820d4edadd9b478c212ac6bb3d121` on `feat/m3-family-hub`.
The signed review commit contains this report and the selected [14-image synthetic manifest](round-19/after/manifest.json). The full isolated browser proof contains 60 hash-verified captures outside Git.

## Delivered and verified

| Scope | Change | Evidence and limit |
| --- | --- | --- |
| #22 / #29, landscape family board | At 1280×752 the message and photo share a bottom edge at y=736, with 16 px viewport clearance. The long all-day school-closure title wraps fully. Six person targets remain 44 px high with at least 39 px bottom inset in both themes. Empty day cards contract to about 193 px. Agenda badge counts match the calendar collection, including when birthday context is present. | Opened the original prospect and final light/dark synthetic browser captures. Focused tests and the full isolated browser proof passed. The physical fridge and final owner comparison remain open. |
| Display content and access | A selected, authorized grocery card remains reachable below the single family board. Dinner is not duplicated: it is shown in Today/Tomorrow, while an authorized editor opens only on request. Preview uses the same secondary-card policy; server projections and explicit read/write grants remain in force. The long week list stays off the default family board; member Home and standalone week layouts keep it. | Real browser proof tested re-pairing, preview/paired parity, six-person roster, grocery/dinner data, privacy mode, hidden-child and message ACL negatives. It used an isolated temporary DB and synthetic data. |
| #16, ICS | Import errors now distinguish a download-byte limit from an occurrence limit, interpolate numeric details, and avoid literal `{placeholder}` text. Manual sync and preview use the same notice. Moved recurring events overlapping the requested window are retained. | Regression tests failed before the fixes and passed after. The full 783-test suite passed. Byte, heap, time, occurrence, SSRF, vault and access limits remain. The user's private failing URL and its actual size were not tested; #16 stays open. |
| #24, public candidate | App and worker run the source-bound schema-48 image; database remains on its existing volume. Fresh pre-cutover and post-cutover backups, isolated restore checks and rollback-image compatibility passed. | App, worker and DB healthy. Public HTTPS smoke passed 11/11, including real synthetic form login, member navigation/reload on desktop and mobile, asset hashes, anonymous access boundaries and logout. A synthetic **public paired-display screenshot** and physical fridge check were not performed; local isolated paired captures are below. |

## Visual comparison

The [original prospect](../ChatGPT%20Image%2024.%20sep.%202026,%2023_52_06%20(4).png) sets the composition direction; Samvev keeps its own identity and real, authorized content. The prior [dark landscape](issue-29-round2/landscape-dark.png) clipped the lower message/photo row at 1280×752; the [new dark paired view](round-19/after/paired-display-dark-wall-landscape.png) keeps it inside the viewport. Compare [light paired view](round-19/after/paired-display-light-wall-landscape.png), [matching administrator preview](round-19/after/admin-preview-light-wall-landscape.png), [member Home](round-19/after/member-home-light-wall-landscape.png), [mobile Home](round-19/after/member-home-light-mobile.png), [800×1280 portrait](round-19/after/paired-display-dark-fridge-portrait.png), and [1200×1920 portrait](round-19/after/paired-display-light-large-portrait.png).

The paired default board is substantially closer to the prospect. Member Home still has more unused space on days with very little agenda content; #22 remains open for the owner's final visual assessment. Browser viewports do not prove the physical fridge's CSS viewport, touch behavior or rendering.

## Verification and release

- Source tree and screenshot manifest were clean and bound to `c3ad869`; the [selected manifest](round-19/after/manifest.json) contains only synthetic names, portraits and content.
- Local `samvev-m1` isolated QA: workspace typecheck PASS; 783/783 tests PASS (web 273, contracts 7, core 3, API 500). The test DB was `samvev_test`, separate from QA, LAN and public data.
- Local real-browser display proof: PASS with 60 source-bound captures, including 800×1280 and 1200×1920, both themes, paired display, preview, Home, calendar setup/errors and negative access cases.
- Security review PASS; requirements review's concrete badge-count finding was fixed with a birthday-plus-overflow regression. UX review's light-theme person inset and count findings were fixed and visually rechecked.
- On `claude`, schema-48 code-only preparation, prebackup/isolated restore, cutover, postbackup/isolated restore and rollback-image checks all passed. The previous `079abc88` image and Compose override remain available under the private operations directory `.local/m3/round17/ops/finish-c3ad869/build/`. No database migration was added and no live database restore occurred.
- Public HTTPS smoke: 11/11 PASS; all 15 served assets matched the frozen candidate hashes. This verifies an actual synthetic account login and logout, but does not verify every private integration or a physical device.

## Open acceptance and owner checks

| Issue | Current status / next evidence |
| --- | --- |
| #22 | Visual implementation improved; owner prospect comparison and further member Home empty-state polish remain. Keep open. |
| #29 / #24 | Round-2 design is published as a tested descendant of `d4885cb`. Local portrait/landscape screenshots and public assets/login are verified. Confirm the existing physical fridge and, if needed for #24 closure, capture the paired public synthetic display at 800×1280 and 1200×1920. |
| #16 / #14 | ICS UI and error fixes are live. An authorized administrator should retry the specific private calendar and record its technical error/size without sharing its URL. Google/Microsoft account consent is separate. |
| #3 / #12 | Open dropdown contrast on Chrome for Windows and physical Shelly/iPad behavior need their respective real environments. |
| #13 | Claude adapter remains synthetic-test only until the owner configures an API key and authorizes a real provider test. No AI task or schedule was changed here. |

Open PR #25 and the separate `samvev-homeassistant` integration were not modified. The existing Home Assistant link, user backgrounds, data, images, vault, rights, school tasks A/B and their schedules were preserved. No physical HA command, AI call, PR, merge, main push, force push, tag, release or Actions dispatch was made. No secret, private family information or real calendar URL was introduced into Git.
