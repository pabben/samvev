# Round 17h — grounded school answer candidate (2026-11-06)

Source/deploy: `42c1a9995c540cd36264d7b7df486af00d3a9324` on `feat/m3-family-hub`. Public test URL: <https://samvev.pabben.org/>. Scope is school task A's answer path; school task B, recipients, approvals and schedules were not changed. The full Round 17 goal remains open.

## Finding and change

R17g required the model to copy both `answer` and `evidence.quote` verbatim from a bounded source document. Four ordinary R17g A runs failed at final schema or exact answer/quote anchoring. The saved metadata does not reveal the historical model text, so a specific historical sentence cannot be reconstructed. The concrete flow weakness was the dependence on two independently model-written exact strings.

For a web answer that fails ordinary validation, the existing bounded strong repair turn now receives a server-built catalog of source excerpts with opaque IDs. The model selects an ID; Samvev resolves it against the same bounded source snapshot and constructs both the answer and exact quote. The current contract remains **extractive**: `answer` is the selected source text, not an unsupported family summary. The selector cannot submit a free-form claim. Wrong/stale IDs, wrong source, mismatched stated date, unrelated excerpts against configured terms and low confidence fail closed with allowlisted technical reason codes. A `none` result is distinct from fetch/model failure and requires a single complete source visible in the repair turn. Long or multiple sources cannot be declared empty through this repair path. No source text, model output or private URL is added to error diagnostics.

## Verification

- Isolated local `samvev_test`: workspace typecheck and full QA passed **744/744** (web 253, contracts 7, core 3, API 481, worker 0). After the last code adjustment, typecheck, 62 focused tests and 3 scheduled-worker scenarios passed. Synthetic HTML/PDF tests cover adjacent date/action lines, source version, wrong source, false date, irrelevant excerpt, invented claim, low confidence and incomplete-source rejection. No real model was invoked by these tests.
- Exact-source runtime image built on the public host at schema 46. Code-only prepare, private backup, isolated restore, cutover, postdeploy backup and isolated restore passed. No migration or live database restore was needed. Immediate rollback is the prior R17g app/worker image and Compose override retained in the private operations directory.
- Public HTTPS smoke passed **11/11** with **13/13** served asset hashes, including anonymous privacy, synthetic form login, member navigation and logout. App, worker and database were healthy. The temporary local synthetic credential copy was removed.
- The one read-only postdeploy lookup confirmed the worker source `42c1a9995c540cd36264d7b7df486af00d3a9324` started at 2026-11-06 10:22:41 UTC. **No completed scheduled A run on this worker existed at that lookup.** There was no manual A run or real AI test in this round; a successful source-grounded A result and any delivery remain unverified.

The next evidence is the first ordinary completed A run on this source. Inspect its outcome and safe reason once it exists. Do not treat passing synthetic tests or public smoke as proof that A has succeeded. No private family data, credentials or school content were committed.
