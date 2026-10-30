# Round 17 — school diagnostics follow-up

## Source and scope

R17d source `4ad3273b09e3b77e0ccbe33e7f7c763f47e6058a` raises the answer cap to 2048 and shortens the answer prompt while preserving source, quote, headline, and weather content. QA passed 723/723, `npm run check` passed, focused checks passed 95/95, and scoped security/requirements/UX reviews plus the predeploy gate passed. Deployment evidence and the absence of R17d scheduled school outcomes are recorded below.

R17d source `4ad3273b09e3b77e0ccbe33e7f7c763f47e6058a` public deployment and verification passed: code-only prepare/cutover, predeploy and postdeploy schema46 backups with isolated restores, healthy app/worker/database on the exact runtime image, public health HTTP 200 and HTTPS smoke 11/11 with 13/13 exact asset hashes. Synthetic login/navigation/logout made no non-auth mutations. Immediate code-only rollback target is the preceding public R17c image/source `a0bdb1ffd45740ce2e5ffeefe4f1e48478dc10b9`; no live DB restore was performed. No private credential was copied into Git; temporary local copy deleted. R17d isolated QA passed 723/723. The visual evidence remains bound to `9f3e83b7e3102d04bcf3569330f81475afd5076c`: canonical latest14 and rich45 hashes were preserved and not relabeled for backend updates.

## Bounded observations

- A no-model, read-only probe found the private school's root HTML response was 623 characters, while the same-origin linked PDF response was 1,238 characters. This indicated that useful source material was linked separately. Private URL, raw text, names, and household details are omitted.
- In the last evidenced pre-R17c scheduled run at 17:44 UTC, task A failed `final_schema/invalid_json`, with output shape `object`, size bucket `257_2k`, and `likely_truncated`. An output-token cap of 300 is suspected, but the cause is not confirmed.
- A safe no-model probe fetched task B's same-origin linked PDF successfully once. It does not establish the cause of the actual scheduled timeout; B remains unresolved.
- R17c answer tasks preserve HTML input and do not auto-follow PDFs. R17c event tasks follow same-origin PDFs and apply a retry fence.
- The configured R17c resultKind is `answer` for A and `events` for B. The earlier B timeout and upstream error are distinct observations. No new scheduled success has been observed; resultKind alone does not verify repair. Preserve approvals, schedules, history, and content; do not run manually or call a model for diagnosis.
- A's scheduled result at 2026-10-30 18:47:08 UTC on public source `a0bdb1f` failed `AI_RESPONSE_INVALID` at `provider_response/output_limit_reached` after two AI calls. This safely observed failure confirms the R17c answer cap of 1024 was insufficient; no raw output is retained here. A remains unresolved, and this was not a successful repair. B has no new scheduled success; its earlier timeout and upstream error remain distinct observations.
- R17d is publicly deployed and verified; its passing checks establish build and deployment quality, but do not establish a successful scheduled school result.
- Public FotMob example ICS URLs in `webcal` and `https` forms both fetched and parsed 33 events. This public fixture parity does not verify the owner's private ICS source.

No private source URL, raw source text, names, credentials, or household data is included. The active user background and original source remain unchanged. R17d public deployment and scoped verification passed as documented above. Immediate rollback is application code/image only to R17c; no live database restore was performed.
