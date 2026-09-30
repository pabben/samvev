# M3 design round 2 — 2026-09-30

Explicitly activated mailbox commit: `127a3b79d27d3f4035e2793d8e6e2db1fbacf7f5`.
Final signed source: `99185975a758548dacbe11210834c9fbd9a06c55`.
The initial composition/U1 checkpoint was `d032b6019e298e7ff128d63f9c70b8735f043a90`;
the final checkpoint strengthens dark photo-backed text contrast.
The protected main `.git` remains at historical `390f6a6a6027e257a5250cfed1cc0517b6974bd3`.
Only the existing `.local/design-review-publish` feature checkout performs Git writes.

## Implemented priorities

- P0: independent panel heights; four complete named personal previews with real
  event dates; both reminder titles/recipients and an actual human message visible
  at 1180×820 and 1280×752 in both themes. Full personal details remain accessible.
- P1 desktop: light people/agenda align, reminders occupy the useful family area;
  message approximately two thirds plus a real observation companion. Dark sparse
  Tomorrow no longer stretches with Family. All primary content, complete short
  message and actual companion fit at 1920×1080.
- P1 mobile: compact greeting/date/status/compose and four identities; concise
  reminder previews with complete details; three full Today rows fit. The second
  row ends at y632.42, navigation begins at y772: 139.58px clearance.
- P1 materials: stronger blue/rose/mint/lilac reading cards; original local
  [generated dusk landscape](../../../apps/web/src/assets/nordic-dusk-v2.provenance.md)
  behind restrained navy glass. A visual iteration darkened the upper overlay
  after actual image-backed status contrast measured below AA.
- P2: natural single-column mobile person cards, restrained avatar rings,
  shared keyed DOM order, and focus return to a visible personal disclosure when
  theme change hides the original detail trigger. No duplicate support widget.

## U1: real synthetic QA admin/admin

The UI alias `admin` maps only to internal `admin@demo.invalid` when trusted
setup status is simultaneously claimed, demo, and demo-enabled. Ordinary
installations retain email input; the supplied password always reaches ordinary
server hash authentication. General new/change-password policy remains strong.
No API/schema/seed/migration change or authentication fallback was introduced.

`bash scripts/qa-demo-admin-password.sh` checks exact Compose labels/service/
health, QA volume/runtime/origin, actual database/user, claimed demo installation,
locked enabled administrator and one exclusively synthetic household membership.
It changed only that existing account's hash and ordinary password-change
metadata. A second execution was a no-op. Independently compared aggregate
hashes prove other account hashes/identities, household, people, memberships,
messages and integration data unchanged. Run this explicit procedure after fresh
QA demo provisioning; generic provisioning and other demo passwords are unchanged.

Literal `admin/admin` reached the actual LAN Home in focused QA and again after
M3. Wrong-password rejection, real UI logout, non-demo email behavior and ordinary
strong password policy were verified. Independent post-capture browser verification
at `2026-09-30T04:00:27.514Z` again typed literal `admin/admin`, observed the
ordinary email/password login request, displayed real Family Hub and completed
UI logout; browser errors and blocked outbound requests were empty.

## Executed checks and fixture history

Existing Node 24.20.0 environment, sequential checks, no dependency installation:
web check PASS; web unit tests 28/28; QA credential tests 4/4; core/contracts
password tests 6/6; real-Git publication/provenance tests 7/7.
Explicit checkpoint builds use only `bash scripts/design-review-build.sh`.
The final build and mounted worktree match 164 immutable Git inputs, with
independently verified LAN HTML/CSS/JS/image hashes. No additional build follows
capture.

Final focused real-LAN browser run: `2026-09-30T03:50:29.129Z`, source above,
ten normal viewport images, failures/errors/outbound requests all empty.
Both themes/five sizes pass strict low-height/mobile geometry, Axe, 44px controls,
DOM order, theme/resize dialog persistence and focus, controlled empty/no-overflow,
ordinary email mode and UI logout. Dark photo-backed text was separately measured
against every background-only pixel in each real text Range; minimum ratios:
1920 5.128, mobile 7.785, portrait 7.556, landscape 5.060, Shelly 4.919.
All measured areas meet their applicable 4.5:1 or large-text 3:1 AA threshold;
this is bounded evidence for the sampled real fixture, not every possible image.

Two earlier focused attempts had defects in the ignored QA measurement helper:
scoped rectangles resolved the document root, date/title selectors were wrong,
focus was checked before its scheduled frame, and logout targeted a hidden
desktop control on mobile. Evidence was preserved, helpers corrected without
weakening criteria, and the complete focused suite passed. These were test-helper
failures, not demonstrated Today/layout regressions. Only the independently
confirmed image-backed contrast issue changed product code.

The canonical M3 harness ran exactly once, correct configured LAN Origin,
10/10 groups PASS and browser errors empty. It verifies real bearer/database/
member/display SSE, actual display render ACK, NB/EN source language, idempotency,
provenance/details, ten viewport/Axe checks, system/focus/reduced motion,
1/4/8 people/long content, credential reveal/revocation and offline expiry.
Normal harness mutations withdrew the old synthetic greeting, created the current
one, paired a restricted synthetic display, created the current integration,
revoked prior harness integrations and created/revoked a UI-test integration.
Final projection: four people, nine active items, one human message; Today three
and Tomorrow one. No manual reseed, redating or reset occurred. The aggregate
snapshot named pre-regression was collected after the harness started and is
not claimed as a true before-run snapshot. Preferences returned to nb/system.

Operational evidence is ignored under `.local/m3/design-round2/`: final-logs,
focused-final, actual-composited-contrast.json and regression/lan-final. No broad
M1 reset/test profile, npm ci/install, container restart, volume removal or prune.

## Final capture and visual limits

Final command: `bash scripts/design-review.sh`. Round
`20260930035832-99185975-5a933bde`, captured `2026-09-30T03:58:32.912Z`,
records the signed source above in [latest/manifest.json](latest/manifest.json).
All 14 files were opened visually and independently checked for SHA-256, PNG
dimensions, correct Family Hub, four people and nine active items. Ten viewport
images cover both themes at 1920×1080, 390×844, 820×1180, 1180×820 and 1280×752;
four supplemental full-page images are desktop light 1920×1312, desktop dark
1920×1196 and mobile light/dark 390×2705. No login/error page was captured.

All 164 mounted build inputs match immutable source Git bytes; served HTML, JS,
CSS and the local landscape match build hashes. Build timestamp
`2026-09-30T03:45:03.492Z` precedes capture. The manifest honestly records
`workingTreeDirty:true` for review documentation/artifacts, without source drift.
Previous latest was archived byte-for-byte under
`archive/20260930021038-11d43fd9-727d21a4/`; 31 older archive files also remain
unchanged. Post-capture literal login/logout passed as recorded above.

Viewport comparisons support P0/P1 above; portrait retains early message and
usable two-column organization. Final full-page mobile images confirm natural
single-column person cards. The fixed navigation appears at the original viewport
boundary in full-page supplements; the normal viewport captures are authoritative
for navigation clearance. Exact reference parity and ChatGPT Work approval are not
claimed. Compact dark avatars retain a minor soft glow as nonblocking P2 polish.
Larger/longer feeds scroll naturally; remaining secondary widgets sit
below the primary composition. Images are member Home, including Shelly-sized
captures; physical wall hardware is not certified.

## Files, rollback and boundaries

UI: family-hub.tsx, home-presentation.ts, home.css, main.tsx, demo-login.ts,
locales en/nb, new local PNG/provenance and relevant web tests. QA: guarded
password scripts/tests; capture and M3 credentials/asset checks. Documentation:
review README, scripts README, M3 artifact notes, this report and M1 status.
Final evidence includes all 14 images, manifest and preserved previous round.
ROUND_1_REPORT.md and the activated mailbox remain unchanged.

No migration. UI/tooling rollback is a normal signed revert and explicit QA build;
credential rollback requires an equally scoped ordinary hash update, never reset.
Only synthetic content and explicitly approved test credentials were introduced.
No private data or real secrets. Three existing QA services remain running.
No PR, merge, deploy, main/force push, tag, release or Actions dispatch.
