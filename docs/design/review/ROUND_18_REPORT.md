# Round 18 — family board and display presentation

Round ID: `20261106214420-eccb1554`

Source and public test deployment: `eccb1554081c9600a6f3e63b9fc855854aaa9596`
Visual evidence: [45-image manifest](round-18/after/manifest.json), captured from a clean source tree with six synthetic people. The signed review commit contains this report and the images.

## Delivered and checked

| Requirement | Change | Evidence and status |
|---|---|---|
| Ready-to-use family display | New setups start with the family view, messages, week and connected items. Advanced card choices remain optional; applying the recommendation preserves optional selected cards and all existing source, person, media and action grants. | Focused tests, full isolated QA and browser proof PASS. Existing display settings were not migrated or widened. |
| First-screen composition | Today/Tomorrow lead; the six-person roster is compact; active message and permitted album image share the next row. Long calendar lists move below the primary view and duplicate day/dinner headings are removed. Member Home has a continuous people/photo column and a secondary full-width week. | Opened paired and preview captures in both themes, wall landscape/portrait and mobile. UX review PASS after narrow light preview correction. |
| Preview and access | Preview uses the same `FamilyHub` board and the display's existing projection and grants. Its layout responds to the preview frame. Optional HA state is a read-only, display-grant-filtered snapshot, capped at eight items; no entity IDs, actions or credentials are sent. | Isolated browser proof PASS including preview/live content, hidden-child and message ACL, re-pair, board read access and mobile day-card geometry. Security review PASS. Physical device remains unchecked. |
| Status copy | A stored task/recipient authorization failure is described separately from the current viewer's permission failure, with the last-check time. Task cards hide extensive source evidence behind details. `/display` help describes configured content rather than only messages. | Focused web tests and complete QA PASS. School A/B execution, recipients, approvals and schedules were not changed. |
| Background and privacy | Selected household and display backgrounds remain separate. The original user image and its choice were not changed. Synthetic standard/custom background captures cover both themes. | [Custom light paired display](round-18/after/paired-display-custom-background-light-wall-landscape.png), [custom dark preview](round-18/after/admin-preview-custom-background-dark-wall-landscape.png); no private background published. |

## Visual comparison

The [agreed prospect](../ChatGPT%20Image%2024.%20sep.%202026,%2023_52_06%20(4).png) remains the visual direction. The implementation keeps Samvev's brand and real, authorized content. Compared with the earlier synthetic [member Home](round-17/after/member-home-light-wall-landscape.png), the [new Home](round-18/after/member-home-light-wall-landscape.png) places the photo directly under the compact roster; the week follows the primary board. The earlier [paired wall view](round-17/after/paired-display-light-wall-landscape.png) put less useful content first; the [new paired view](round-18/after/paired-display-light-wall-landscape.png) leads with Today/Tomorrow and the roster. The [new matching preview](round-18/after/admin-preview-light-wall-landscape.png) uses the same board. The narrow [light mobile preview](round-18/after/admin-preview-light-mobile.png) now stacks readable day cards. The [dark paired wall](round-18/after/paired-display-dark-wall-landscape.png) shows the glass treatment, message author image and album image. No fabricated weather, device state or message was added to production.

Residual visual polish: a long dinner label can wrap in a narrow preview, and short messages leave some open space. Browser viewport emulation does not establish the physical fridge's CSS viewport, rendering or touch behavior.

## Verification and publication

- Isolated local `samvev-m1` QA: web 261/261, contracts 7/7, core 3/3, full API suite exited 0; workspace TypeScript check exited 0. No migration changed.
- Clean-source isolated real-browser proof passed with 45 hash-verified synthetic captures, paired display, admin preview, authorization negatives and responsive day geometry. The manifest records `sourceDirty: false` and the exact source SHA.
- Security, requirements, UX and pre-cutover release reviews passed within this design scope. The AI/worker execution diff against previous public `42c1a9995c540cd36264d7b7df486af00d3a9324` is empty. The unpublished AI candidate `727c8dc` remains in Git ancestry but is reverted before this design source.
- On `claude`, runtime-only image build, schema-46 pre-cutover backup and isolated restore, code-only cutover, and post-cutover backup/isolated restore all passed. App and worker are healthy on the exact source image; database is healthy and unchanged. Immediate rollback image and previous Compose override are preserved in protected operational evidence under `.local/m3/round17/ops/r18-eccb155/`.
- Public HTTPS returned 200 for [Home](https://samvev.pabben.org/), [display entry](https://samvev.pabben.org/display), [About](https://samvev.pabben.org/om), [Privacy](https://samvev.pabben.org/personvern), [Terms](https://samvev.pabben.org/vilkar) and health. Anonymous `/api/v1/me` returned 401. All 13 public static assets matched the source image hashes.
- A fresh authenticated public login/navigation test was **not performed**: the previous temporary synthetic credential had been deleted and no authorized replacement was available. Prior public login smoke and the current isolated login/browser checks do not prove the new candidate's authenticated HTTPS flow. No owner session or synthetic production account was created for this check.

## Remaining owner/device checks

On the actual fridge, open the existing paired `/display`, compare it with **Skjermer → Forhåndsvis**, and check legibility, scrolling and touch in both orientations. Explicitly review source and board grants before sharing more data. School tasks A and B remain as before this round, including their existing schedules/status; this design release does not claim to repair them. Google/Microsoft consent and private calendar validation remain separate owner actions in [Round 17 owner actions](ROUND_17_OWNER_ACTIONS.md).

No private family name, photo, calendar content, background, credential or secret was added to these public review artifacts. No PR, merge, main push, force push, tag, release or Actions dispatch was made.
