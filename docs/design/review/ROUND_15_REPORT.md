# Round 15 report – 2026-10-29

## Result

Candidate source: `05cf86dc83ab70070b7050b2c25fa71cff6380bb` (`feat/m3-family-hub`). Issues #16–18 are implemented. UX and security reviews passed for the candidate; requirements review is conditional GO because #19 logo rights and owner actions remain open. Final QA passed, the isolated public clone restore gate passed, and the partial R15 candidate was deployed successfully on 2026-10-29 at 13:35:05 UTC.

- Isolated candidate suite: API 437/437 passed (0 failures); web 207/207, contracts 7/7, core 3/3, and web typecheck passed.
- Final source-05cf functional browser acceptance: 14/14 checks passed.
- Public cutover: PASS. Source/deploy SHA `05cf86dc83ab70070b7050b2c25fa71cff6380bb`; immutable image `sha256:20a587bbc1f8630afdbb02be881ef97f996ae8ee58eaa14c1c7112afdaf61e10`. Database schema advanced 41→45. A fresh quiescent backup and pre-/post-cutover isolated restore gates passed; app, worker, and database are healthy. Data, vault, and configuration hashes were preserved. Completion receipt mtime: 2026-10-29 13:35:05 UTC. Evidence: `.local/m3/round15/ops/cutover-20261029T133220Z/result.private.json`.
- Isolated public clone restore gate: PASS at `.local/m3/round15/ops/public-restore-20261029T132214Z/result.private.json`.
- Public HTTPS Playwright smoke: 11/11 PASS. Synthetic login/navigation on desktop and mobile, anonymous pages, asset hashes, ICS UI, People, AI, and logout passed; no non-authentication mutations were observed. Public health and `/om`, `/personvern`, `/vilkar`, `/display` returned 200. Browser evidence: `.local/m3/round15/public-browser/postdeploy-smoke.json` (mode 600).
- Final canonical six-person capture: Round ID `20261029134403-05cf86dc-28ee8faa`, with 14 masked PNGs; screenshot hashes and source SHA `05cf86dc83ab70070b7050b2c25fa71cff6380bb` match. Capture command `bash scripts/design-review.sh` passed.
- The public test now runs the deployed partial R15 candidate. This is not a claim that #19 rights or owner integrations are complete, nor a merge, tag, or release.
- Round 15 issue recheck at 2026-10-29 13:07:49 UTC found nine open issues and no new comments.

## Requirement boundaries

#19 actual provider logo assets were not delivered because rights evidence is missing. The UI uses generic code-native glyphs with visible provider names. The owner must provide logo-use rights evidence before real logo assets are added.

School task A failed final JSON/schema validation, but the raw model output was not retained, so its exact malformed shape cannot be established. Task B's earlier generic error remains undiagnosed. Neither task is claimed repaired live; no model calls or task configuration changes were made.

External Google/Microsoft consent and registration, the expired-TLS Home Assistant endpoint, private ICS validation, school display activation, and physical iPad/Shelly/real-screen checks remain owner actions. See [ROUND_15_OWNER_ACTIONS.md](ROUND_15_OWNER_ACTIONS.md).

## QA database incident and recovery

An earlier full test accidentally ran against the QA app and truncated its synthetic QA database. The main agent recovered forward from the 00:08 backup into current schema 45 after isolated donor/test restore. Verification covered 86 table hashes and foreign keys, preserved AI rates and usage ledger, login and `/me` 200, and healthy app/worker. QA-only changes made after the backup may be absent. Public data was not affected.

## Screenshots and privacy

The 14 masked PNGs in [`latest/`](latest/) are byte-for-byte copies of canonical six-person Round ID `20261029134403-05cf86dc-28ee8faa`; their SHA-256 values and source SHA `05cf86dc83ab70070b7050b2c25fa71cff6380bb` match the manifest. The previous Round 14 `latest/` was archived under `archive/20261028032511-971913e3-046fbbb8/`. The published manifest retains screenshot hashes and source commit, but omits LAN origin and demo account labels. No private browser images, URLs, secrets, names, or real household data were added.

## Public deployment update slot

Deployment completed 2026-10-29 13:35:05 UTC: source/deploy SHA `05cf86dc83ab70070b7050b2c25fa71cff6380bb`, image `sha256:20a587bbc1f8630afdbb02be881ef97f996ae8ee58eaa14c1c7112afdaf61e10`, schema 41→45. Fresh quiescent backup, pre/post isolated restore gates, service health, data/vault/config preservation, and public HTTPS smoke 11/11 passed. This is a partial R15 publication; #19 logos remain withheld pending rights evidence, and school/HA/Google/Microsoft/ICS/physical-device owner items remain open.
