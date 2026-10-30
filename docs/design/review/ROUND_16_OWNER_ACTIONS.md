# Round 16 — remaining owner actions

These are unresolved validation or account/device steps. Public R16 test deployment, HTTPS smoke, backup and isolated restore have passed; none of the owner actions below was performed. School task A/B diagnosis remains engineering work, not an owner action. Integrated synthetic re-pairing and six-person preview/live parity passed separately; the actual target screen still needs owner validation.

| Action | Why it remains open | Boundary |
|---|---|---|
| Validate private ICS source and Google/Microsoft OAuth consent or registration | These require private calendar data, credentials or provider owner consent not used in synthetic QA. | Owner-controlled. Do not include URLs, tokens or private event content in reports. |
| Confirm display setup and behavior on actual Shelly/iPad/paired screens | Synthetic 752×1280 real-API/browser parity passed, but it does not prove hardware behavior or the current public Kjøleskap data setup. | Physical-device and owner-session action. No real screen pairing or source grants were changed for testing. |
| Review Kjøleskap preview against its intended public live projection | A six-person synthetic paired preview/live proof passed; current real Kjøleskap has no selected calendar source display targets or board read grant, so its intended rich content is not owner-approved or compared. | Owner can explicitly choose permitted sources/cards/grants and compare the actual screen with preview. Do not broaden grants automatically. |
| Review issue #3 theme-menu behavior on the target desktop platform if needed | Candidate visual work was reviewed, but a platform-specific Windows/Chrome open-menu check is not evidenced here. | Manual UI validation; do not infer closure solely from aggregate screenshot review. |

School task A remains at latest observed status `final_schema/schema_mismatch` and task B at `AI_UPSTREAM_ERROR` after successful tools. Their root-cause analysis and any confirmed repair are engineering work; preserve their history, approvals and schedules, and do not make a new model call or mutate/reactivate either task as part of diagnosis. HA calendar sync was already observed successful at 2026-10-29 21:35 UTC, so no TLS renewal action is currently indicated by that old blocker. Provider-mark use rights are confirmed and recorded; no further #19 rights action is pending.
