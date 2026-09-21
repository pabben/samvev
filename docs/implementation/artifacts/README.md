# M1 evidence index

The accepted final evidence is linked from M1_QA.md and M1_DELIVERY.md.

| Directory / file | Meaning |
|---|---|
| `coordinator/` | Independent final test log, runtime/database/visual verification and full dependency audit |
| `qa-final/` | Latest complete fresh-install smoke, focused regressions, UX screenshots and passing visual comparison |
| `runtime-final/` | Successful retained-runtime smoke and focused replay; fixed named owner/Robin fixture |
| `qa-approved-baselines/` | Original twelve reviewed images; original/corrected mask manifests and exact four-mask correction provenance |
| `qa-candidates/` | Immutable reviewed source manifest from 02:46:05.751Z; source of approved images |
| `qa/acceptance-post.json`, `qa/restart-state.json` | Latest complete actual worker-restart evidence and exact ledger IDs |
| `qa/demo-accessibility-visual.json` | Latest explicit synthetic-demo and accessibility execution |
| `qa-final-diagnostic/` | One-page capture diagnostic; not the complete acceptance result |
| `frontend-final/ux-qa/` | Earlier ten-check/seventeen-image UX evidence personally reviewed by UX before independent final QA |
| `frontend-final/ux/`, `frontend-final/components-debug/` | Superseded partial/debug captures, not complete acceptance |
| `frontend-candidates/` | Overwritten by QA's 02:49 distinct-person runtime control; not original frontend acceptance or an approved baseline |
| `frontend/`, other legacy `qa/` reports/images | Historical implementation and failing Gate C evidence; read execution timestamps and their README |
| `devops/` | Image/dependency remediation and synthetic pre-upgrade backup provenance |

`qa-final/visual-compare-failure.json` records the earlier 03:41:52Z border
difference. It is superseded by `visual-comparison.json` at 03:53:53Z; the current
PNGs are the latter run. Failed/intermediate JSON is retained without treating
it as passing evidence. Original frontend 02:02 image files were overwritten by
the later control; that fact is explicitly recorded in their directory README.

All people, credentials and content are synthetic. No browser storage state,
cookies, pairing verifiers or bearer tokens are included. Pairing-code captures
show one-time synthetic test requests, not reusable display credentials.

Visual matrix pages use a fixed client calendar/clock only. Real API/SSE data
and card/footer times are asserted separately from the original live screen;
functional, offline and worker-restart contexts keep real clocks. No baseline
image replacement, broad mask, percentage threshold or skipped rule obtained
the final passing comparison.
