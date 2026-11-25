# M3 design round 1 — 2026-09-30

Executed only after the user's explicit activation of
[`NEXT_CODEX_PROMPT.md`](NEXT_CODEX_PROMPT.md), received from feature commit
`175e0daf3b636f82ef33a927742f6006aeb7a516`.

## Source, running UI and review evidence

Signed final source checkpoint: `11d43fd93c6a0be4f7d37978071866c237629c91`.
The initial composition checkpoint `c1de2f42365472554cf5566014b1ef9f1419471c`
was followed by the 44px Home-brand touch-target correction
`947d2205eefb826ffdc6fedf14d04950d03b7f32` and the final dark support-grid
correction above. Each source checkpoint has DCO sign-off.
The existing independent publishing checkout `.local/design-review-publish`
is canonical. The main checkout's protected `.git` still reports the historical
`390f6a6a6027e257a5250cfed1cc0517b6974bd3`; it was not repointed, unlocked or
written. All 157 tracked build inputs in the mounted worktree were independently
verified byte-for-byte against the source checkpoint before the explicit build.

Run `bash scripts/design-review-build.sh`, then exactly
`bash scripts/design-review.sh`. The build proof records source SHA, input
fingerprint, all built HTML/asset hashes, Node 24 version and QA container ID.
Capture validates the actual served index and assets before and after capture,
and checks which assets the browser loaded. The final source SHA comes from the
publishing checkout, never the stale protected HEAD. The later review commit
contains evidence and does not redefine the captured source.

Final round `20260930021038-11d43fd9-727d21a4`, captured
`2026-09-30T02:10:38.156Z`, is recorded in
[`latest/manifest.json`](latest/manifest.json). All 14 final images were actually
opened and compared with the originals and archived baseline. PNG dimensions,
all SHA-256 values and every manifest source/theme/viewport entry were independently
verified; all show authenticated synthetic Family Hub UI, without login/errors.
The previous round remains intact under
[`archive/20260929230125-390f6a6a-76ac151b/`](archive/20260929230125-390f6a6a-76ac151b/).
The intermediate source-947d220 round is also retained at
[`archive/20260930020142-947d2205-d1024603/`](archive/20260930020142-947d2205-d1024603/);
its valid source/build evidence preceded the final P1.2 balancing correction.
Both archive sets were independently checked against their prior image bytes.
Documentation and newly generated evidence can make `workingTreeDirty=true`;
build inputs still must exactly match the committed source. This flag is computed
at capture time, not copied from an old build.

The explicit build completed at `2026-09-30T02:10:26.227Z` using Node
`v24.20.0`. Its input fingerprint is
`994ca70b334c79680d43e1e430552d455223c0cdada8e612972e14d6a2c36ea2`.
An independent LAN HTTP fetch verified SHA-256 equality for `index.html`,
`assets/index-DQhtPoAn.css` and `assets/index-BOFRhtOf.js` against the proof.
At final build/capture preparation, differences from canonical source were
review documentation and intermediate latest/archive evidence only. All 157
build inputs still matched committed source. The protected root HEAD remained
unchanged. The shell wrappers use host Node 22 for provenance; required web
checks/build/capture run on QA Node 24, and the seven tooling tests also passed
on the existing Node 24 binary copied into ignored `.local/` with host Git.
Final independent check/test output is retained locally in
`.local/design-review/final-tests.log` and
`.local/design-review/final-tooling-tests.log`; both commands exited zero.
Build evidence is the successful explicit build and its hash-linked proof;
no additional build was run during the final release gate.

## Implemented review points

- P0.1: compact Home navigation retains all routes/settings; one compact
  date/time/greeting area; light person/day-plan primary composition; dark
  adjacent Today/Tomorrow/Family/Remember panels. Shared keyed sections have
  theme/viewport-correct DOM order, without duplicated interactions.
- P0.2: compact named family identities on mobile/portrait; important reminders
  remain visible; agenda/message precede full person cards and support content.
  Landscape/Shelly use height for content, without zoom or font scaling.
- P0.3: warm ivory and coloured light cards; deeper navy, restrained translucent
  dark materials and original local `evening-ridge.svg`. No external image fetch.
- P1.1: larger consistent coloured initials, dynamic names and actual content.
  No invented photographs, rewards or completion claims.
- P1.2: actual human messages precede summary/list support cards, with author,
  time and distinct material; AI-derived content remains separate. Final dark
  full-page review exposed a narrow three-widget stack beside a large blank
  field; it was corrected to a full-width message and three balanced support
  columns without changing the content or DOM/control tree.
- P1.3: real Today/Tomorrow event-time groups and honest empty states. Personal
  content uses “Til deg” / “For you”, rather than falsely describing already
  published past events as upcoming. No events were manually redated or deleted
  to improve the pictures.
- P2: coordinated type/spacing/radius/icons; compact accessible status and
  demo labels; Samvev brand on mobile; localizable NB/EN text and keyed detail
  dialog portals preserve state when composition order changes.

## Validation and fixture history

The mandatory existing M3 harness's assertions were preserved. Initial full run
and two instrumented diagnostic runs failed on display render acknowledgment.
The message body was visibly rendered and the real ACK was sent, but HTTP 403
was correct: browser origin `http://qa-app:4173` differed from configured
`SAMVEV_PUBLIC_ORIGIN=http://192.168.0.220:4173`. The harness/capture now use the
exact configured QA LAN origin; backend Origin/CSRF and visibility checks were
not relaxed. Exact allowlists, demo verification before mutation and blocked
external browser requests protect the synthetic scope.

Four subsequent complete LAN harness runs passed. Required retests followed
the 16px wide-header spacing/strict-origin guards, the confirmed 44px brand
target fix, and the confirmed dark support-grid correction. Last execution:
`2026-09-30T02:09:57.019Z`, all 10 groups PASS, browser errors `[]`.
Its ignored operational evidence is
`.local/m3/design-round1/regression/lan-balanced-final/results.json` and adjacent log.
Covered: real display ACK; producer NB/EN language; bearer/API/PostgreSQL/member
and display SSE; idempotency; target people/time/provenance dialogs; ten
viewport/Axe checks; viewer NB/EN/system/focus/reduced motion; 1/4/8 people and
long content; credential one-time reveal/revocation; offline expiry.

Each of the seven harness setups used synthetic fixtures and paired displays,
revoked previous harness integrations and withdrew previous synthetic greetings
as the documented harness normally does. Compared with the archived September
29 pictures, the current set has fresh September 30/October 1 event dates:
Today has three events; Tomorrow has one. There are four people, nine active
integration items and one active synthetic family greeting. No private household,
child, location, calendar or credential data was introduced. Capture itself does
not reseed data and restores preferences/logs out its own session.

During QA, an unintended separate test-profile run created isolated test
containers/database in the same exact Compose project. It did not access QA
fixtures or volumes. A concurrent root build encountered a dependency-install
race. The two temporary test containers were removed individually after exact
label checks; no volumes were deleted and no broad down/prune/reset was run.
The required web checks/build were then repeated sequentially. The extra test
volume is unused; the only running services remain qa-db, qa-worker and qa-app.
The existing Node 24 binary was copied from qa-app into ignored `.local/` so
real-Git provenance tests could run with host Git, avoiding any global install.

The required checks run on Node 24 are web typecheck, web 24/24 unit tests,
web production build, publication 3/3 tests, and combined publication/provenance
7/7 tests including real Git inputs, ignored generated output, untracked-source
rejection and archive rollback. Syntax and diff checks pass. A negative proof
check correctly rejected capture preparation before any proof existed.

The focused real-LAN interaction test additionally verified that an open detail
dialog survives theme and viewport changes, that focus returns on close and
that actual DOM order matches the three compositions. All visible interactive
controls measured at least 44×44px. The first complete mobile Today row ends
at y766; fixed bottom navigation begins at y772. A temporary diagnostic initially
asserted that the entire three-event panel must fit; the mailbox requires one
complete agenda row, so the diagnostic was corrected to that actual requirement,
without changing any repository regression assertion. Normal login rate limiting
was observed after repeated QA sessions; its window was allowed to expire with
no reset or bypass.

| Surface | Final visual assessment (separate from functional test PASS) |
|---|---|
| 1920 light | Four pastel person areas + Today/Tomorrow; primary y244; full real message card ends y1069. |
| 1920 dark | Four adjacent main panels; message fully visible; balanced three-widget support row in full-page image. |
| 390 both | Samvev, four named identities, both reminders and one complete agenda row above nav; message precedes full people/support. |
| 820 portrait both | No broad rail; four identities + full agenda and human message visible. |
| 1180 landscape / 1280×752 both | Primary around y208; real person content + full agenda rows visible. Dark Shelly lower details for the fourth person require scrolling. |

## Files and operational boundaries

Product: `apps/web/src/{member.tsx,family-hub.tsx,home-presentation.ts,home.css}`,
`locales/{nb,en}.ts`, original `assets/evening-ridge.svg`.
Tests: `apps/web/tests/{home-presentation.test.ts,m3-family-hub.mjs}`.
Review tooling: `scripts/design-review{.sh,.mjs,-build.sh,-provenance.mjs,
-provenance.test.mjs}`; review README, this report, manifest/images/archive and
`docs/implementation/M1_STATUS.md`. The activated mailbox remains unchanged.

No backend/API/data-model or migration changes. Rollback is a normal signed
revert on the feature branch and a new explicit local QA build/capture; no volume
reset is required. Only the existing synthetic QA services are left running.
No PR, merge, deployment, release, main push, force push or Actions dispatch.
The only configured Actions workflow triggers PRs and main pushes, not this
feature-branch push. Root Git protection and unrelated source files are preserved.

Independent final release gate: PASS before the evidence commit. It opened both
references and all 14 final images, verified 157 Git inputs and three LAN-served
assets, both archives, 47 staged review files, source DCO sign-offs, Node 24
check/test logs and final M3 results. Read-only GitHub checks found zero feature
PRs and zero feature Actions runs. The main agent then performs the authorized
DCO evidence commit and ordinary feature-only push.

## Visual limits

The measurable first-viewport requirements are the acceptance evidence; test
PASS is not a claim of pixel-identical original-reference parity or ChatGPT Work
approval. The dark landscape remains an original stylized ridge rather than the
reference's photographic depth. The light human-message panel spans the width,
and support widgets extend below the first desktop viewport with this real data.
Sparse agenda data can leave tall neighbouring panels. Images are member Home,
including TV/Shelly-sized captures; paired-display behavior is separately tested,
and physical Shelly hardware certification is outside this round.
