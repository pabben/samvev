# M3 design round 4 — 2026-10-01

Activated the complete mailbox at `4ec2c249555596a202384966d13aa0c04d80263f`.
Final DCO-signed source: `8cc0236b4a3dd4ce43eee36591f74e75de6f4e88`. Publication evidence is committed separately.

## Concrete visual result

Both original references and all 14 Round 3 images were opened before editing.
The ten actual candidate viewports were compared with those references; the
material proposal was retained after visual review, rather than increasing
transparency or rebuilding the accepted composition. Native zoom exposed two
confirmed problems, which were corrected and followed by a complete retest.

- Light desktop: sky-blue greeting and mint perimeter replace the beige/peach
  emphasis. Blue/pink/mint/lilac identities have shallow directional shading and
  warm off-white reading areas; no luminous halo or invented portraits.
- Dark desktop: deeper neutral navy main glass has a restrained reflection and
  fine upper edge. Warm/lilac reminders and the teal/plum human-message surface
  are distinct layers; the existing landscape, crop and lower overlay remain.
- Mobile/tablet: the same materials add no decorative height. Portrait retains
  observation under Tomorrow and the human message before detailed people.
  Existing structured-kind icons have consistent strokes and optical sizing;
  font sizes, semantic mapping and message hierarchy are preserved.
- iPad landscape/Shelly: avatar, name and metadata use the full card's center
  axis with and without Details. The control has its own normal-flow track and
  reflows in genuinely narrow cards; dark compact rows remain left-aligned.
- True 200% zoom: panel headings wrap safely. Below 320 CSS px, existing hero
  content occupies separate rows, identities/navigation use two columns and
  bottom clearance preserves terminal content. Normal five-size layouts and
  section order are unchanged. Four mobile navigation targets measure 85×58.

## Validation actually run

Existing isolated `samvev-m1` QA app/database/worker were reused, without reset,
provisioning, password preparation or installs. Only `apps/web/src/home.css`
changed; no functional/API/auth/data/schema/tooling change justified a mutating
M3 harness. Earlier rounds' M3 tests are historical, not claimed as rerun here.

- Node 24: `npm run check --workspace @samvev/web` PASS;
  `npm run test --workspace @samvev/web` **32/32 PASS**.
- Explicit `bash scripts/design-review-build.sh` after each signed source
  checkpoint. Final 164 root inputs equal source Git blobs and build proof;
  all four built files equal actual LAN HTTP bytes. No build after capture.
- Complete final focused LAN suite: both themes/all five sizes, Axe, overflow,
  44px targets, first viewport, calculated more/localized Details, details/focus,
  theme/rotation, native provenance Enter/Space and open/focus regrouping,
  current-projection revision/withdrawal/expiry/person removal; **PASS**.
- **14** read-only empty/long-Tomorrow/missing-observation/1–4–8-person stress
  cases PASS. Mock projections were never used for published images or written
  to QA data. All four identities and both real reminders remain visible;
  desktop and low-height variants retain full human message and real support.
- **12** NB/EN baseline/long-name axis cases at 1001/1180/1280, with/without
  controls: PASS, maximum avatar-axis error 0.008 px, name/metadata 0 px;
  no collision, overflow or undersized control. Fallback geometry/Axe PASS.
- Fresh actual composited text contrast, normal and derived no-blur fallback:
  **minimum 5.031:1, PASS**, including opened provenance in both themes.
  Paired normal/text-transparent PNGs identify actual glyph pixels, compare
  computed foreground (including alpha) with the same-layout background and
  apply normal 4.5:1 / large-text 3:1 thresholds. Unrendered closed/offviewport
  nodes are explicitly recorded. Earlier all-rectangle diagnostic contamination
  was retained as invalid measurement evidence, not a product contrast result.
- True Chromium `chrome.tabs.setZoom(2)` via ignored local MV3 helper: light/NB
  and dark/EN desktop 1920→960 and mobile 390→195 CSS px PASS. DPR becomes 2,
  CSS zoom stays 1; greeting/clock do not overlap, visible nav targets fit,
  terminal text/provenance/footer clear fixed nav. Actual top and CDP end
  screenshots were opened. Earlier blank Playwright scaled-scroll captures
  were diagnostic artifacts, not runtime failures.
- Literal UI admin/admin login, actual Family Hub and UI logout PASS in focused
  QA; temporary preferences restored to nb/system. Post-capture smoke and final
  evidence verification are recorded below after capture.

Ignored execution evidence remains under `.local/m3/design-round4/`, including
final `focused-final-8cc/`, `material-axis-final-8cc/`, `native-zoom-final-8cc/`,
`final-logs-8cc/` and `actual-composited-contrast-8cc.json`. Initial failures and
invalid measurements are preserved; tests were corrected for visible controls
and naturally changed dates, not weakened to hide a UI defect.

## Natural data and limits

The ordinary clock is now October 1 in Europe/Oslo: Today has one event,
Tomorrow none, compared with three/one on September 30. Four people, nine items,
two reminders and one human message remain. Stored prior-day events can still
appear in personal previews according to existing projection rules. No events
were redated, reseeded, added or kept alive for capture. The old three-row Today
fixture condition cannot be certified from today's real screenshots alone.

Initials remain a truthful fallback instead of illustrated reference portraits.
Icon/type refinement is modest; visual reference parity is not an automated
PASS or Work approval. Shelly images show member Home at 1280×752, not physical
hardware or paired-display certification. The known fixed-nav stripe in mobile
full-page supplements is a capture artifact; viewport images are primary.

## Publication and operations

`bash scripts/design-review.sh` PASS: round `20261001144432-8cc0236b-66eead31`,
captured `2026-10-01T14:44:32.232Z`, honest `workingTreeDirty: true` for
review documentation/evidence outside immutable build inputs. All 14 actual Home
PNGs were opened by integrator, UX and requirements reviewers and independently
verified against manifest SHA-256, theme, viewport and source. Full pages are
1920×1302/1202 and 390×2508/2521; viewport files retain all five required sizes.
The previous Round 3 latest set was archived byte-identically (15 files); all
61 older archive files, both originals, mailbox and three prior reports remain
unchanged. No mock/stress screenshot is published.

Post-capture literal **admin/admin** → ordinary authentication request → actual
Family Hub → UI logout on `http://192.168.0.220:4173` PASS. Content/account
aggregates and all authentication hashes equal the pre-round snapshot; admin
revision remains 2. Health is OK and QA app/database/worker remain healthy.
Protected root HEAD remains `390f6a6a6027e257a5250cfed1cc0517b6974bd3`.
All 164 final mounted inputs and four served files match source/build proof.
Independent final verification: `.local/m3/design-round4/final-verification.json`.

Independent final release gate **PASS**: source/build/HTTP/PNG hashes, all
683 staged root/publishing/index files, archive preservation, QA evidence,
health, unchanged data/authentication and protected Git metadata were checked.
GitHub read-only checks found zero feature PRs and zero feature Actions runs.

Review evidence is prepared for DCO-signed publication through the established
publishing checkout, explicitly only `git push origin feat/m3-family-hub`.
Latest manifest: [latest/manifest.json](latest/manifest.json).
Later captures use `bash scripts/design-review.sh`; after a new signed source
checkpoint, first run the explicit `bash scripts/design-review-build.sh`.
No extra build was performed after this capture.

Changed tracked paths: `apps/web/src/home.css`, this report,
`docs/implementation/M1_STATUS.md`, all 14 `latest/` PNGs and manifest, and the
15-file archive of the previous valid Round 3 set. Original references, mailbox,
previous reports, older archives and review tooling remain byte-identical.

No migration. Rollback is a normal DCO-signed revert of the CSS changes followed
by the explicit QA build; do not reset data or rewrite history. No secrets or
private data introduced. No PR, merge, deploy, main/force push, tag, release or
Actions dispatch. Only explicit feature-branch publication is authorized.
