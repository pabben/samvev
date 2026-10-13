# Round 8 — one product shell and six-person family composition

Revised mailbox: `0de2d8149ad2c3f611b021c594cd9ad94bbd2743`.
Candidate source: `15d047192abd63f4be18a90108fe969096da78d0`.
Ordinary LAN round: `20261013220837-15d04719-3db04bd7`.
The later review commit records final evidence; it does not identify a different UI.

## Product changes and visual iteration

Home, Messages, People, More, Displays, Integrations, Monitors and AI now share one
persistent member shell. Home's composition remains separate from that shell.
The desktop brand/navigation/account positions and mobile brand/bottom navigation
persist across pages. More remains the active primary destination for its child
pages, which have visible context and a return action. Page transitions focus the
main heading and reset scroll without introducing routes or additional permissions.

Warm light cards and navy dark layers now extend to member content, forms,
preferences, person editing, composer, confirmations, login, inactive invitation
and isolated first-run setup. Task pages keep their own readable widths and
natural scrolling. Integrations' advanced details remain secondary. AI values,
price caveats, provider behavior and disconnected setup are preserved.

Person accents and chosen portraits follow existing authorized person IDs and
avatar keys across Home, People, message authors, participant stacks and composer.
The first four explicit choices retain their colors; avatars five and six have
stable peach/aqua accents, and null avatars keep an ID-derived initial fallback.
No name inference, additional roster disclosure or capability change was added.

The primary isolated fixture has **six synthetic people: two adults and four
children**. The existing age/role model is used; children do not acquire admin
permissions. Desktop compares actual available panel width with meaningful card
width and fits six readable columns. Short landscape iPad/Shelly use a balanced
compact 3×2 group. The agenda no longer inherits multiple empty tall person rows.
Six identities, three Today events, Tomorrow/reminder access and the authored
message fit the bounded wide fixture, including whole controls. Mobile and
portrait reflow naturally and retain their established content priorities.

An initial fifth-person list-only test exposed a truthful-count defect: filtered
preview items were being counted as all content. Counts, accessible summaries and
remaining-entry controls now use all authorized current personal items. Full
person details remain the canonical complete view.

The dark material trial raises the existing landscape crop on wide Home/display
and adds restrained upper-right reflection. Actual originals, Round 7 and the
candidate were opened; the ridge supports the greeting more closely and panel
depth improves without disturbing text. The trial is retained. Light stays quiet.
No new art asset was generated. Derived comparison sheets use approximately
normalized original app planes, excluding room/frame/collage; they are not UI
captures or pixel-parity evidence. Original references remain authoritative.
Reference differences remain: broader orange sky, less localized reflection,
more uniform lower navy panels, abstract light wash and different type/density.
No near-identical claim or ChatGPT Work design approval is made.

Actual whole-product checks found undersized delivery summaries and the short
Now tab. Both now have whole 44px targets. Dark person-detail kind icons were
outside Home's theme scope; portal dialogs now use the existing dark palette.
Composited measurement also found four small dark text entries below AA: live
status4.407:1 and mobile Displays/Integrations/Monitors descriptions4.303/4.268/4.116.
They now use existing bright dark text without changing the approved crop or
composition. Final actual normal/fallback measurements supersede the failing
intermediate candidate.
A separate measurement confirmed the dark desktop whole message target fits:
its bottom was 1067.781px within 1080px, with height 113.797px.

## Environments and preservation

- **Ordinary LAN:** <http://192.168.0.220:4173>, existing `qa-db`, `qa-app`,
  `qa-worker`, original volume/configuration. Five people, naturally empty days,
  and the user's existing synthetic long message are preserved. The current
  baseline has 18 stored messages, not Round 7's 17. `admin/admin` remains LAN-only.
- **Isolated actual fixture:** internal `round8-test-app`, separate `samvev_test`
  database, six people/9 items/3 Today events/1 authored message. Real API/database
  capture transport; age dates/names/locations/messages are explicitly synthetic.
  Four-person comparison uses a separate restoration of the earlier synthetic
  four-person backup to this test DB only. No QA installation is reseeded.
- **Isolated first run:** separate `samvev_round8_setup`, unclaimed, demo disabled.
  Welcome/owner form were opened without claiming or resetting an installation.
- **Public:** <https://samvev.pabben.org/> is reachable, but the authorized update
  is **BLOCKED**, not deployed. See the exact missing control-plane details below.

Nine QA tables are compared with fresh Round 8 before-state hashes; protected
main `.git` has 229 unchanged files and retains its stale `390f6a6…` HEAD.
The writable `.local/design-review-publish` provides actual feature metadata.
All 199 allowlisted source inputs are byte-identical between the working files,
canonical publishing clone and source commit. Runtime restart, build receipt,
served asset hashes and final manifests bind the UI to the candidate SHA.
Earlier-source/intermediate evidence is not represented as final-candidate QA.

## Validation and evidence

Final measurements and exact test counts are recorded in
[validation.json](round-8/validation.json), [supplement manifest](round-8/manifest.json)
and [ordinary 14-image manifest](latest/manifest.json).
The ordinary capture command is unchanged:

```bash
bash scripts/design-review-runtime.sh
bash scripts/design-review-build.sh
bash scripts/design-review.sh
```

Complete isolated retest:278/278; five workspace typechecks, four non-web builds,
publication/provenance11/11 and demo guards4/4 PASS. Actual Home70, product shell139
and M3 eleven checks PASS. Four genuine browser200% runs cover15 changed states
each, with preserved preferences and no clipped controls. Composited contrast128
states per normal/no-blur mode PASS; four independently decoded PNG states per
mode agree exactly across38 group comparisons. Literal LAN admin/admin UI login
and logout and all served asset hashes match the frozen source.

All108 current actual captures (14 ordinary plus94 supplementary) and both
derived comparisons were personally opened by the final UX reviewer; all hashes
and dimensions were independently verified. Scoped local UI/evidence is accepted;
public deployment is excluded and remains blocked.
All 14 ordinary latest images are regenerated and opened. The previous valid
Round 7 latest is archived byte-identically at
`archive/20261013194236-f65d75f5-ba8caa81/`; intermediate candidate captures retain
honest earlier-source metadata in their own archive. The primary new review is
the rich six-person set; ordinary LAN still has its five preserved people.

Supplemental captures cover every member page desktop/mobile both themes,
message lanes, AI setup, composer/person details, preferences/person editor,
representative pairing/integration/withdrawal dialogs, login/inactive invitation,
actual isolated first-run forms, selected portrait reflow, actual paired display
and four-person desktop comparison. Stress DTO injection is explicitly separated
from actual baseline captures; no mock screenshot is presented as real transport.

## Authorized public publication — concrete operational block

User authorization is present; no further general deploy consent is required.
The user supplied the historical target: `claude` / `192.168.0.144`, Samvev
root `/home/administrator/apper/samvev`, `.env`, exact project `samvev-m1`,
backend4173, volume `samvev-m1-postgres-data`, historical Newt peer192.168.0.188.
These remain target information, not verified current container/source/proxy facts.

Default SSH encountered a system configuration permission error. No global file
was changed. The connection was concretized with an explicit no-system-config
transport and a workspace-local ignored first-use host-key pin, without modifying
global SSH/known_hosts. SSH reached `administrator@192.168.0.144`, then rejected
login with **Permission denied (publickey,password)**. No SSH configuration exists for administrator. Both existing identity files were
tried explicitly and rejected; agent absence alone was not treated as conclusive.
A separate non-overwriting Ed25519 deployment identity was created in ignored
project-local storage. The user has the concrete pinned-host `ssh-copy-id` command
to install its public key by entering the server password directly in their terminal.
No private key or password is published; this is an access prerequisite, not new
deploy consent. Remote commands have not executed, so active Compose labels,
image/source, DB/ledger, immediate trusted proxy and private public test-account
configuration cannot yet be verified.
HTTPS read-only checks return health200, claimed=true, demo=false and
anonymous member/display projection401. These establish availability and an
access boundary; they do **not** prove current source or authenticated UI.
Public browser-policy headers were absent in that existing response. The
candidate adds a bounded shared CSP/nosniff/referrer/frame policy to ordinary
responses and both raw SSE paths, with short public-only HSTS; this fix is
source-tested and cannot be claimed applied to the unchanged public site.

No public backup, restore gate, migration, image replacement, proxy change,
public account modification or authenticated public screenshot was performed.
Public deployed source remains unknown. LAN `admin/admin` is never exposed as
public backend. Starting a stale local stack or widening proxy trust would not
resolve rejected SSH authentication. Public deployment acceptance remains
BLOCKED until existing authenticated access to claude is supplied.

## Migrations, rollback and limits

No new migration, route, contract, OAuth, provider behavior or accounting change
was introduced. Existing canonical 20-migration ledger is verified for QA/test;
no public migration was run. Candidate rollback is a normal feature revert of
presentation and bounded header changes, followed by source-bound runtime/build
and capture; no stored QA data must be rolled back. A public rollback plan must
first be bound to the actual old immutable image/configuration and verified
fresh backup/restore gate before any public update.

Remaining minor visual polish: small preferences selector text, tall birthday
summary on mobile Messages and differing portrait heading alignment. True200% uncovered narrow-view overflow in tabs, birthday/preferences, More,
person editor and welcome. At <=319px these now wrap/stack; only the aria-hidden
decorative welcome scene is hidden. Text sizes and full controls remain; no
global overflow clipping is added. Natural
scroll is retained for long forms/content and genuine 200% zoom. No live AI call,
ChatGPT consent, eligibility, account balance or subscription load is verified.
No private data, secrets, active invitation/pairing code or token is introduced.
No PR, merge, main/force push, tag, release, Actions dispatch or unrelated
application/global server change is performed. Only the feature branch is
published; the public deployment block is stated rather than bypassed.

## Changed source files

- `apps/web/src/family-hub.tsx`
- `apps/web/src/home-presentation.ts`
- `apps/web/src/home.css`
- `apps/web/src/integrations.tsx`
- `apps/web/src/locales/en.ts`
- `apps/web/src/locales/nb.ts`
- `apps/web/src/main.tsx`
- `apps/web/src/member-navigation.ts`
- `apps/web/src/member-shell.css`
- `apps/web/src/member.tsx`
- `apps/web/src/messages.tsx`
- `apps/web/src/people.tsx`
- `apps/web/src/person-identity.ts`
- `apps/web/src/ui.tsx`
- `apps/web/tests/home-presentation.test.ts`
- `apps/web/tests/member-presentation.test.ts`
- `apps/web/tests/round8-design.mjs`
- `apps/web/tests/round8-shell.mjs`
- `services/api/src/app.ts`
- `services/api/src/browser-security.test.ts`
- `services/api/src/browser-security.ts`
- `services/api/src/external-intelligence.integration.test.ts`

Evidence changes are confined to `docs/design/review/latest/`, honest earlier-source
archives, `docs/design/review/round-8/`, this report and `docs/implementation/M1_STATUS.md`.
Private backups, raw browser/QA logs, cookies, connection metadata and deployment
keys remain ignored under `.local/`; no secret is staged.

## Final gate

Security: source and artifact/privacy PASS. Requirements: local criteria1–5/7 PASS.
UX: scoped local UI/evidence ACCEPT after opening108 actual images and2 comparisons.
Release gate: local feature publication readiness PASS, with independent checks of
199 source inputs, live runtime fingerprint,20 migrations,10 built/served assets,
108 screenshot hashes/dimensions, comparison inputs,224 prior evidence files,
229 protected Git files and nine QA tables. No local P0/P1 finding.
Full Round8/public criterion6 remains BLOCKED on confirmed SSH authentication,
with the prepared deployment key awaiting user installation. No public deployed
source or authenticated HTTPS navigation is claimed.
