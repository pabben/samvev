# QA artifacts

Artifacts are generated only from isolated synthetic fixtures. No cookie,
storage-state, pairing verifier, session token or private household data is
stored here.

- `acceptance-*.json` records clean UI and worker-restart phases. The current
  `acceptance-pre.json` is intentionally failing at preference persistence.
- `demo-accessibility-visual.json` records aggregate Axe findings, including
  node selectors and contrast calculations.
- `display-{mobile,shared,shelly-xl}-{en,nb}-{light,dark}.png` are actual
  paired-display captures from the browser acceptance run.
- `visual-baselines/` were created once using the explicit
  `QA_UPDATE_VISUAL_BASELINES=true` mode. Normal visual comparison is read-only
  and currently fails; it must not overwrite a baseline.
- `failure-*.png` are diagnostic captures from a failing run and are not
  passing evidence.
