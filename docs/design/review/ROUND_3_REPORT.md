# M3 design round 3 — 2026-09-30

Activated mailbox: `de14831183115604c368825bc560e76970b8e7c1`.
Final DCO source: `da31a7d757d81b4a8308b9a41f6239c2367d3952`.
Initial composition checkpoint: `757f257`; whitespace checkpoint: `f61d2db`.
Git writes use only `.local/design-review-publish`, feature branch
`feat/m3-family-hub`; protected root HEAD remains `390f6a6…`.

## Concrete changes and visual comparison

- Dark desktop/landscape: Today and Tomorrow remain distinct neighbours.
  Tomorrow now groups an existing observation below it; a different existing
  summary accompanies the human message. No duplicated or fabricated widget.
  The previous Tomorrow void is replaced with meaningful vertical content.
- Portrait: Tomorrow/observation ends approximately y763 beside Today at y728;
  the message follows at y778–922 before detailed person cards. The previous
  large empty area beneath Tomorrow is resolved without empty panel padding.
- Both low-height themes retain four names and complete real personal previews,
  both reminder titles/recipients, an agenda row and the full human message.
  Light Shelly message ends approximately y727.
- Both mobile themes retain four identities, two reminders and three complete
  Today rows. Third row ends y696.02; navigation begins y772: 75.98px clearance
  (the enclosing agenda card ends approximately y709).
- Light personal areas have a clearer colour-to-reading-surface transition,
  calmer rules/metadata and consistent semantic icon accents. Message author,
  avatar and body now lead the quieter heading; tall desktop body uses 65ch.
- Dark landscape is unchanged as a local asset; lower navy fade quiets rocky
  foreground and secondary content, avatar glow is removed, and support cards
  keep their own content height. No external asset/font/runtime dependency.
- Reminder arrows sit inside the existing single title button. Person controls
  show calculated localized “1 til”/“1 more”, or “Detaljer”/“Details” when no
  entries are hidden. Complete content/provenance remains accessible.

Visual comparison opened both authoritative original PNGs and all 14 Round 2
images before changes, then inspected ten real candidate viewports. This supports
better composition/discoverability; it does not establish a new parity score,
pixel-identical reproduction or ChatGPT Work approval. Dark remains more
photographic than the reference. Physical Shelly hardware is not certified.

## Iteration and final checks

A real repeated browser finding showed observation disclosure open/focus state
was lost on portrait-to-mobile regrouping. Final source records open intent at
semantic summary activation and restores its identity after React commits.
Item/person dialogs live at a stable parent, resolve current projected IDs,
and close when selected content expires, withdraws or becomes unavailable.

Earlier ignored helper failures were preserved: reminder selectors included a
personal duplicate, ordering was checked before render, portrait was incorrectly
expected to use wide ordering, and transient resize caused an unconfirmed
8-person overflow. Correct scoped/layout-aware assertions and composition waits
fixed the helpers without weakening the criteria; fresh diagnostics and all
14 stress probes have no page overflow. Only the confirmed disclosure bug
changed product code after the first visual candidate.

Final Node 24 checks in existing QA environment: web TypeScript PASS, web tests
32/32 PASS. Explicit production build: `bash scripts/design-review-build.sh`.
Independently verified 164 mounted inputs equal immutable source Git bytes;
LAN HTML, JS, CSS and existing PNG match build hashes. No installs/restarts.

Final focused LAN browser at `2026-09-30T18:22:42.134Z`: ten normal viewport
images, five text-transparent diagnostics, failures/errors/outbound requests
empty. Both themes/five sizes cover real fixture geometry, Axe, 44px controls
including summaries, NB/EN detail labels, DOM order, system theme, dialog
Escape/focus through rotation/theme, disclosure Enter/Space and relocation.
Read-only projected responses test empty/all, empty Tomorrow, long Tomorrow,
missing observation and 1/4/8 long-name households (14 surface probes).
Normal Home polling verifies dialog revision/withdrawal/person removal; actual
local expiry ticking closes selected expired details. These responses are
browser-only test substitutions, never persistent fixture changes or published
mock screenshots.

Fresh actual composited-text measurements use every background pixel in real
text-node Range rectangles, with foreground colours/fonts from those nodes:
minimum ratios desktop 4.924, mobile 7.763, portrait 7.432, landscape 4.866,
Shelly 4.735. All meet their applicable 4.5:1 or large-text 3:1 thresholds.
These are bounded measurements for this fixture/asset, not arbitrary content.

Literal LAN admin/admin, real Home and UI logout pass; preferences are verified
restored to nb/system. Existing QA-only alias and ordinary hash verification are
unchanged; no password procedure was run. No full mutating M3 harness was run:
only presentation/dialog state changed, and focused coverage plus unit tests
exercise those changes. No API, auth, data flow, schema or migration changed.
Review tooling is unchanged; its historical test result is not claimed as a new
Round 3 run. Ignored runtime evidence is under `.local/m3/design-round3/`.

## Final capture and data preservation

Final command: `bash scripts/design-review.sh`. Round
`20260930182826-da31a7d7-1886d5b2`, captured `2026-09-30T18:28:26.849Z`:
[latest/manifest.json](latest/manifest.json) records the final source above.
All 14 real Home PNGs were opened and checked for hashes, dimensions, theme,
source and four people/nine active items. Ten viewports cover both themes at
1920×1080, 390×844, 820×1180, 1180×820 and 1280×752. Full-page supplements:
desktop light 1920×1302, dark 1920×1202; mobile light 390×2687, dark 390×2700.
The known fixed-nav strip in mobile full-page capture remains a capture artifact;
normal viewports are primary. No login/error screenshot was published.

Previous latest was archived byte-for-byte under
`archive/20260930035832-99185975-5a933bde/` (15 files); all 46 older archive
files are unchanged. Final 164 input hashes and four served assets independently
match source/build proof, built `2026-09-30T18:19:28.633Z` before capture.
Manifest `workingTreeDirty:true` honestly reflects review documentation/artifacts,
without build-source drift. There was no build after capture.

Independent coordinator UI smoke at `2026-09-30T18:30:01.134Z` typed literal
admin/admin, observed the ordinary internal email/password request, displayed
real Family Hub with four people/current human message, and used UI logout.
Browser errors and blocked requests were empty.

The existing synthetic fixture/clock is preserved. Evening greeting/time now
reflect household time naturally instead of Round 2's morning capture. No new
message, redating, reseed, provisioning or integration/display mutation occurred.
Independent before/after aggregates for accounts/households/people/memberships,
messages, integration connections and items are identical. All authentication
hash/password-change aggregates are unchanged; admin revision remains 2.
Projection still contains four people, nine active items and the same human
message. Account preferences returned to nb/system; normal sessions/audit events
from authorised login are outside the content-aggregate comparison.

## Files and operational boundaries

Source: family-hub.tsx, home-presentation.ts, home.css, locales en/nb and
home-presentation.test.ts. Evidence: this report, M1_STATUS.md, all 14 latest
PNGs/manifest and the automatically archived previous set. Round 1/2 reports,
mailbox and original references remain unchanged.

No migration. Rollback is a normal signed revert plus explicit checkpoint build;
existing QA data and admin/admin remain intact. No private data/new secrets.
Existing qa-db/qa-worker/qa-app stay running. No PR, merge commit, deploy,
main/force push, tag, release, broad Docker cleanup or Actions dispatch.
