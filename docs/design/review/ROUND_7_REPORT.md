# Round 7 — responsive actions and layered family materials

Activated mailbox: `37cfcb6b384aecbfec0b974af1a554ed77084eba`.
Final DCO-signed source: `f65d75f55cdf3ed0a7fd2915e97d045923c6e35c`.
Round ID: `20261013194236-f65d75f5-ba8caa81`.
The following review commit contains documentation and screenshots only. Source
SHAs identify the tested application, not that later review commit or the
protected main checkout's stale HEAD.

## Result and visual iteration

Light mobile now has an explicit 44px **Ny beskjed** action in the human-message
heading in both filled and empty states. It uses the existing authorized composer;
actual isolated tests cover open, cancel, Escape, focus return, real publication,
full message access through the counted collection, withdrawal and restoration.
Display and read-only sessions retain their existing permissions.

Dark wide Home and paired display show both reminders in the bounded fixture;
preview limits follow the available composition: three on tall dark wide surfaces,
two on short dark wide surfaces and one in compact/light compositions. Counts and
current collections preserve access to the remaining entries. Zero, one, two and
six reminders with long titles are covered. A single portrait reminder spans its
inner panel; **Foreldremøte** remains an ordinary unsplit word when there is room.
The whole lower controls fit dark Shelly 1280×752 with a margin and 44px targets;
1180×820 and light Shelly remain covered.

Light green shapes now frame the application softly against a warm cream/sky wash.
Dark foreground rocks recede, outer panels have upper-edge reflections and depth,
and inner reminders, people and the human message retain distinguishable materials.
The existing local resources, avatars, typography and composition remain.
[Normalized light comparison](round-7/comparisons/comparison-light.png) and
[dark comparison](round-7/comparisons/comparison-dark.png) show the authoritative
original app plane, Round 6 and Round 7 at the same 960px app width. These are
explicitly derived comparisons: approximate perspective normalization excludes
the reference room/frame/collage. Original, old and new hashes are recorded in
[comparison manifest](round-7/comparisons/manifest.json); these are not UI captures.

Concrete differences remain. The reference dark has broader/brighter and more
varied upper-right reflections and stronger separation from its black field.
Samvev's lower panels remain more uniform navy and its header landscape is a
broader muted sky. Light uses an abstract wash rather than recognizable foliage.
Existing font, content density and proportions differ; there is no near-identical
claim, numerical design score or inferred ChatGPT Work approval. No weather/meal
widgets or sample-reference content were invented.

AI now labels the server's global counts **Bekreftet sendt** and **Uavklarte
forsøk**, independently of narrower priced groups. Known normal-use credit
estimates, priced/unpriced coverage, unknown cost and equivalent API USD scenario
are distinct; USD is explicitly not account balance. NB and EN convey the same
scope. No DTO, amount, SQL, provider, OAuth or accounting behavior changed.
Seven actual synthetic usage rows yield 5 confirmed, 1 unresolved, four priced
and two without an estimate; known totals remain 1.41000000 credits and
0.05640000 equivalent API USD, with forecast and balance unknown. These are
fixture results, not real charges. Live consent, eligibility, inference, expiry
and real credits remain unverified; zero real provider calls were made.

Visual iteration found and fixed short-display lower control clipping, mobile AI
explanation/forecast clipping and undersized composer mode controls. Actual 200%
native browser zoom then exposed mobile composer header/close/form overflow;
scoped narrow reflow fixed it without changing normal 390px layouts. Failed
intermediate logs and images remain ignored locally. Helper assumptions were
corrected to open the counted message collection for a second real message,
restore the desktop viewport after compact SSE checks, and wait for stable live
status/fonts before composited contrast capture. Tests retain real publication,
SSE without navigation, offline expiry, focus, geometry and authorization checks.

## Verification

| Check | Result |
|---|---|
| Node 24 checks | Five workspaces PASS |
| Complete isolated retest | 272/272: web46, contracts5, core3, API218, worker0 |
| Explicit non-web builds | contracts/core/API/worker 4/4 PASS; no web rebuild after capture |
| Provenance/publication pipeline | 11/11 PASS with real Git available |
| Round-7 browser checks | 51/51; no errors, blocked requests or provider calls |
| Actual isolated M3 regression | 11/11 PASS including member/display SSE and offline expiry |
| True native browser 200% | Four runs, both themes/languages, Home/person/composer/AI PASS |
| Composited normal/no-blur contrast | 30 states per mode, all PASS; minimum 4.680:1 |
| Independent stdlib PNG check | Four representative states per mode PASS; group minima delta 0.000 |
| Public source/hash/dimensions | 35 actual screenshots PASS, all personally opened; 2 derived comparisons separately checked |
| Prior review/mailbox/original files | 181/181 byte-identical, including archived previous latest |
| Protected root Git | 229/229 files unchanged |
| Nine preserved QA tables | All fields unchanged, including passwords/preferences/avatar choices |
| Literal LAN admin/admin and UI logout | PASS, five people and all ten served asset hashes |
| Existing qa-db/qa-app/qa-worker | All three healthy; LAN health ok |

The minimal test image lacks Git, so its first pipeline run could not execute
the real-Git-blob assertion. The same plain Node/ESM pipeline suite on the repository
host with Node 22.22.1 and Git available passed all 11; no assertion was skipped or disabled.
Detailed intermediate/final evidence stays in `.local/m3/design-round7/`.
Thin currentColor SVG controls retain the 3:1 requirement; their measured 16px
plus has no 80%-coverage pixel (maximum 0.777). Only those icon strokes use
70% coverage with residual ≤2; text keeps 80%/residual ≤10. Both independent
measurement implementations record the rule. This corrects pixel matching,
not contrast thresholds.

Public sanitized results: [validation.json](round-7/validation.json); changed
source: [source-files.txt](round-7/source-files.txt).
Independent security, requirements, UX and QA reviews passed the final source.
The independent release gate ran last and returned PASS after checking the concrete
staged delivery, source/served bytes, preservation, test evidence and critical
images. Feature publication follows this prepublication gate.

## Screenshots, preservation and operations

- [Latest manifest](latest/manifest.json): 14 exact ordinary Home screenshots,
  five viewports × two themes and four full-page supplements, captured by
  `bash scripts/design-review.sh`.
- [Round-7 manifest](round-7/manifest.json): 21 actual supplementary captures:
  rich Home10, actual paired display2, open light-mobile composer1, filled
  person4 and usage overview4. Source/time/theme/viewport/hash/dimensions and
  actual synthetic API/database state are explicit. No capture injects transport.
  Later 1/4/8, long-content and read-only stress projections are injected and
  separately identified in test evidence, not presented as baseline UI captures.
- Previous Round-6 latest is archived byte-identically under
  `archive/20261012234005-158d9e33-d7fb5bdb/`.

The preserved LAN demo already had five people before this round; the user
confirmed all names are synthetic and publishable. The fifth person's unset
avatar remains an initial. Today/Tomorrow and current messages are naturally
empty because stored items expired/withdrew; none were redated or reseeded.
Five people on light desktop/landscape/Shelly naturally extend below one viewport;
full-page evidence records the rest. Rich four-person fixtures, seven synthetic
usage records and mutating tests use isolated `samvev_test`, exact project
`samvev-m1` and internal temporary services without host ports. This is not a
claim that every household's content fits one viewport. Physical Shelly hardware
and Safari/iPad hardware were not tested.

Runtime/build proofs agree with committed/root/publishing-clone input bytes,
restarted app/worker leaf processes, all 20 migration checksums, exact project and
LAN binding. The 191 input files have fingerprint
`e558b80b35fec9b077a501295da100ec82b239eeb304fc779203c9e741b59d39`.
Served asset hashes are checked against the source-bound build; no stale protected
root HEAD is recorded as the new UI's source. The mailbox is unchanged and is
never automatically executed. No secret, private household/child/location/calendar
or credential data was introduced; private backups/logs remain ignored locally.

## Files and rollback

The eleven source files cover Home composition/preview/material CSS, narrow
composer reflow, AI labels/presentation, NB/EN and meaningful UI/unit tests.
Review changes are this report, implementation status, manifests, validation,
35 screenshots, two derived comparisons and archived Round-6 latest.
There is no new migration or backend/OAuth/provider change. All schema 020 data
and existing QA are retained. A rollback is a new signed frontend revert on the
feature branch followed by source-bound runtime/build/capture; retain migrations
and usage/vault/content. Do not restore backups over current QA or rewrite history.

Future review command remains `bash scripts/design-review.sh`, preceded by
`bash scripts/design-review-runtime.sh` and `bash scripts/design-review-build.sh`
when application source/runtime changes, as explained in [README](README.md).
Publication uses `.local/design-review-publish` and only `feat/m3-family-hub`;
no PR, merge, deploy, main/force push or Actions dispatch is authorized or performed.
