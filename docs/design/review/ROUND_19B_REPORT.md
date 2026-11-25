# Round 19B: Home composition and public follow-up

Source/deploy: `8391041ca17ffea124870118b7312f0c50e3da5c` on `feat/m3-family-hub`. Schema remains 48. This is a focused continuation of [Round 19](ROUND_19_REPORT.md); its feature, security and migration scope is unchanged.

## Visible change

Home's I dag/I morgen cards and dinner gap use less vertical space, the light theme subtitle has stronger contrast, and empty agenda badges no longer distract from a person card. A browser regression exposed school freshness/actions overlapping dinner in the integrated Home layout. The school row now grows to contain its content. The final synthetic [Home light](round-19b/after/member-home-light-wall-landscape.png), [Home dark](round-19b/after/member-home-dark-wall-landscape.png), [mobile light](round-19b/after/member-home-light-mobile.png), [mobile dark](round-19b/after/member-home-dark-mobile.png), [paired portrait](round-19b/after/paired-display-dark-fridge-portrait.png), and [administrator preview](round-19b/after/admin-preview-light-wall-landscape.png) are recorded in the [source-bound manifest](round-19b/after/manifest.json). Compare with the [previous source-bound set](round-19/after/manifest.json) and the original prospect in `docs/design/ChatGPT Image 24. sep. 2026, 23_52_06 (4).png`. Images use a six-person synthetic fixture and contain no live family data.

The main agent opened the final wall, mobile and portrait images. Today's content is easier to locate and the school row no longer collides with dinner. The stepped empty area below a short Tomorrow card remains a visual compromise caused by the taller family column. Issue #22 stays open for owner assessment; physical fridge rendering is not claimed.

## Checks and deployment

- Isolated browser display proof: 60 source-bound screenshots, access negatives and preview/paired parity PASS on this clean source. The new overlap assertion failed on the prior layout and passed after the school-row fix.
- Local web tests: 274/274 PASS; workspace typecheck PASS. The unchanged backend's earlier 500 API, seven contract and three core tests remain valid from Round 19. No test touched public data.
- Security, requirements and UX scoped reviews: PASS. No data permission, migration, AI job, schedule, HA command or calendar source changed.
- Public `claude` code-only build, capacity gate, backup and isolated restore, cutover, postrestore and rollback-image checks: PASS. A stopped, unreferenced old project runtime image was removed to satisfy the existing free-space gate; no volume, backup or current rollback image was deleted. Prior public source `c3ad869e207820d4edadd9b478c212ac6bb3d121` remains the immediate rollback image.
- Public app, worker and database: healthy on source `8391041`. Authenticated HTTPS smoke: 11/11 PASS, including synthetic account login/logout, direct navigation, anonymous access checks and all 15 served asset hashes. The smoke did not capture public screenshots or verify a physical device.

Open owner checks are unchanged from Round 19: #22 prospect acceptance, #29 physical fridge and public paired visual check, #16 private failing ICS source, #3 Chrome on Windows dropdown, #12 physical Shelly/iPad, and optional #13 live Claude setup. Google/Microsoft owner consent is separate. No PR, merge, main/force push, tag, release or Actions dispatch occurred.
