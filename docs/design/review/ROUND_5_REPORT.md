# Round 5 — reference composition, person details and ChatGPT-plan usage

Date: 2026-10-04. Activated mailbox: `34faa81c1f85b0449f749d8ef725b2944f3b7d27`.
Final signed source: `b6a30b2d95443a02192da7bc089820585fde8169`.
Round ID: `20261004124113-b6a30b2d-7d49ba64`.
The subsequent signed review commit contains this report and evidence; it changes
no build inputs. The manifest deliberately records the tested source, not that
later documentation commit or the protected main checkout's stale HEAD.

## Visual and functional result

Both authoritative PNG originals were opened and compared with the final real UI.
The light composition now has tall illustrated person fields beside Today/Tomorrow,
with a lower message/support row. At 1920×1080, the person-card height/width is
2.046, the person section occupies 69.2% of the inner board, and the identity image
occupies 29.4% of the card height. These correspond to the originals' measured
approximately 2.05–2.08, 69.4% and 28–31%. Dark has four aligned glass panels and
an actual-content lower row. Portrait overlap was fixed through visual iteration;
short displays retain visible message/reminder entries. Mobile has its own compact
family feed/focus composition and direct person selector, rather than stacked
complete desktop person cards. The footer name/tagline and its spacing are removed;
header identity remains.

Six optimized local, fictional illustrated avatars are explicitly selectable and
persisted. No face is inferred from a name. Four existing synthetic QA people were
assigned avatar-01 through avatar-04 through the actual edit/save/reload UI; only
avatar choice, person revision and update timestamp changed. Identity is consistent
in cards, selectors and details. Human-message avatars require actual author ID;
display projections expose only the already authorized card author's avatar key,
without expanding the display's person roster. Asset provenance, prompts, hashes
and licensing are recorded in the [avatar provenance](../../../apps/web/src/assets/avatars/PROVENANCE.md).
The six transparent 512px WebP assets total 294,532 bytes (96.8% below original PNGs).
All six were inspected at 44/80/120px in both themes.

Direct identity buttons open ID-bound desktop drawers/mobile full-height sheets,
including zero/one/many entries. Details preserve full text, time, location and
source, distinguish household content, expose editing only with existing rights,
and handle focus, Escape, live removal and expiry. NB/EN, system theme, reduced
motion, no-blur fallback, 44px targets and native browser zoom are covered.

## AI route and limits

Existing AI services now support explicit ChatGPT-plan, API-key and local routes.
The plan route follows the official open-source/self-hosted preview documentation:
local-browser loopback OAuth companion, PKCE/state/nonce and token validation,
secure transfer/import, stable VM host ID, owner/household-bound encrypted vault,
serialized rotating refresh and disconnect handling. Streaming Responses uses
`store:false`; only completed results publish. Unsupported fields are omitted and
there is no paid fallback. Queued and scheduled work rechecks the current owner,
capabilities, connection and settings binding before dispatch/publication; terminal
plan errors pause rather than loop. Revocation withdraws affected scheduled output.

AI and usage settings show the active route, daily/model/purpose usage in 7/30-day
periods, test versus ordinary operation, unknown usage, credit forecasts and a
separate equivalent-API USD scenario. Durable attempt IDs prevent double recording.
Pinned official rate snapshots, precise arithmetic, caching/reasoning accounting,
zero-use days and insufficient-history warnings are tested. Account credit balance,
eligibility and expiry are not invented. Rendering settings makes no provider call.

**Live OAuth consent, this account's eligibility/model permission, live inference,
actual balance and expiry remain unverified.** There was no previously authorized
live connection in this QA database. All connection code, tests and onboarding are
complete; no real or paid provider call was made. Automated provider tests use
injected transport, and browser tests inject explicitly marked state/stress DTOs.
None of the 34 published screenshots uses injected transport.

For connection, follow [the complete connection guide](../../CHATGPT_PLAN_CONNECTION.md):
run the two-file Node 24 companion on the browser machine with the VM host ID shown
in AI settings, complete OpenAI consent locally, then securely SCP the private
0600 export to the VM and use the documented owner/household-bound import command.
Remove the transfer file after import. Refresh AI settings, select an authorized
catalog model and save as the owner. Never paste tokens into chat, Git or LAN URLs.

## Verification on final source

| Check | Result |
|---|---|
| Node 24 workspace checks and explicit review build | PASS |
| Complete isolated workspace retest | 261/261: web40, contracts5, core3, API213, worker0 |
| Provenance/publication pipeline tests | 11/11 |
| Round-5 browser groups | 17/17, no blocked provider calls |
| Actual isolated M3 regression groups | 11/11 |
| Composited glyph contrast, normal and no-blur fallback | 30 surfaces each; minimum 4.680:1 in both modes |
| Independent stdlib PNG contrast cross-check | Three representative surfaces × two modes, matching minima |
| True native browser 200% zoom | Four NB/light and EN/dark desktop/mobile runs; no overflow |
| Final screenshot hashes/dimensions/source | 34/34 |
| Prior review/archive/mailbox/original hashes preserved | 94/94 |
| Protected root Git files preserved | 229/229 |
| Actual LAN admin/admin login and UI logout | PASS, preferences restored |
| QA app/worker/database and LAN health | Healthy, `/api/v1/health` returns ok |

Automated tests explicitly include API AI test files, OAuth rejection/isolation,
refresh races, terminal errors, disconnect/publication barriers, capabilities,
usage/pricing/idempotency, and migration checks. Browser coverage includes actual
API/SSE/display pairing/ack/provenance/offline expiry, 0/1/many person details,
keyboard/focus, theme/rotation, 1/4/8-person and long-text variants, Axe and targets.
The rich baseline is actual scoped API data in a separate restored synthetic test
DB; a later presentation-stress group injects projections. The round-5 state harness
also injects presentation/AI DTOs, and does not claim live account verification.

Local detailed logs/results are retained under `.local/m3/design-round5/final-logs/`,
`isolated-m3-final/`, `isolated-browser-final/`, `material/` and `native-zoom/`.
Public sanitized results: [validation.json](round-5/validation.json).
Independent security, requirements and UX reviews passed on the final source;
the main coordinator independently checked critical claims and opened all 34
final public images. The independent final release gate returned PASS after
evidence preparation, including explicit final-source Node 24 typechecks, runtime,
data, all manifests and served assets. No blocking findings remain.
Unavailable configured scout/QA model aliases required default-agent fallbacks;
writing remained sequential and the main agent remained sole integrator.

## Evidence and preserved data

- [Latest manifest](latest/manifest.json): all 14 conventional Home images,
  five viewport sizes in both themes plus four full-page supplements.
- [Person/AI/usage manifest](round-5/manifest.json): 12 actual LAN images,
  desktop/mobile light/dark; onboarding is expanded in settings full-page images.
- [Rich isolated manifest](round-5/isolated-rich/manifest.json): eight actual
  member/display images with three Today entries, nine new scoped integration
  items and one human message. These are isolated test data, not LAN mutations.
- Previous latest is archived unchanged at
  `archive/20261001144432-8cc0236b-66eead31/`.

The LAN's stored content is naturally expired: all 213 integration items expired
by 2026-10-03T03:54:04Z; its 17 messages are four expired and thirteen withdrawn.
Thus latest honestly shows four people and empty current agenda/messages. The
rich images prove non-empty composition without reseeding or redating LAN data.
Full before/after DB comparisons preserve all account fields/password hashes,
households, memberships, 31 connections, 213 items and 17 messages. Legacy person
fields are identical apart from the expressly authorized avatar/revision changes.
No secret, real household, child, location or credential data was introduced into
public files. Backups and private intermediate evidence remain ignored locally.

Runtime proof verifies byte-identical source/root/clone inputs, actual API/worker
leaf processes, all 19 migration checksums, exact project identity and LAN binding.
Input fingerprint: `1df71689006168c443ef79e93197a38983097b1947eeba3f1ab922c4e066eb45`.
Served HTML, JS, CSS and image hashes match the build proof and latest manifest.
No new build occurred after final capture.

## Changed files, migration and operations

The [complete source file list](round-5/source-files.txt) records changes from the
activated mailbox to final source. Main groups are Family Hub/materials/dialogs,
avatars/person administration/locales, contracts/Home/display projections,
AI providers/vault/OAuth/usage/scheduler authorization, standalone OAuth companion,
additive migration 019, tests, review provenance/publication tooling and AI docs/
ADR0021. This evidence commit adds reports/status, 14 latest images, the unchanged
prior-set archive, 20 supplementary images and manifests.

Migration 019 is additive and was applied to the existing synthetic QA database;
previous credentials and usage history are retained. A sealed local backup preceded
it. Rollback: disable/drain affected AI tasks and revert application code to a
known-compatible source while retaining additive columns/tables, credentials,
usage and rate history. Do not drop schema or restore/truncate preserved QA as a
routine rollback. The QA database/app/worker remain running at
http://192.168.0.220:4173 with working admin/admin.

Reference differences are intentional real-product differences: actual Samvev
navigation/data, original local fictional avatars and authorized source details.
No fake weather/smart-home controls or invented brief fill reference placeholders.
This is not a claim of pixel-identical screenshot content. Known blocking layout
and identity gaps were iterated and the final independent visual review passed.

Later reviews: `bash scripts/design-review-build.sh`, then after stable QA
`bash scripts/design-review.sh`. The mailbox is preserved and never auto-executed.
Only the feature branch is published with DCO. No PR, merge, deployment, main push,
force push, tag, release or Actions dispatch is authorized or performed.
