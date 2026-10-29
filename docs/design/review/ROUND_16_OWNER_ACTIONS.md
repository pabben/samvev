# Round 16 — remaining owner actions

These are unresolved validation or account/device steps. None was performed as part of the Round 16 source/test work.

| Action | Why it remains open | Boundary |
|---|---|---|
| Decide whether and when to publish the R16 candidate | Public test remains on R15 source `05cf86dc83ab70070b7050b2c25fa71cff6380bb`; no R16 deployment has occurred. | Deployment/production action; separate release gate and authorization required. |
| Diagnose school task A and B from retained source evidence, if available | Latest statuses are `final_schema/schema_mismatch` and `AI_UPSTREAM_ERROR` after successful tools; historical raw causes are unavailable. No repair is verified. | Use an authorized read-only owner session and existing records only. Preserve task history, approvals and schedules; no new model call, copy, mutation or reactivation without separate explicit instruction. |
| Validate private ICS source and Google/Microsoft OAuth consent or registration | These require private calendar data, credentials or provider owner consent not used in synthetic QA. | Owner-controlled. Do not include URLs, tokens or private event content in reports. |
| Confirm display setup and behavior on actual Shelly/iPad/paired screens | Synthetic viewport and minimal-grant preview checks do not prove paired live projection or hardware behavior. | Physical-device and owner-session action. No screen pairing or source grants were changed for testing. |
| Review fridge preview against the intended live display projection | Synthetic preview used minimal grants and produced a short 218px projection; paired-live parity was not demonstrated. | Owner can choose a representative permitted setup for a later controlled comparison. Do not broaden grants automatically. |
| Review issue #3 theme-menu behavior on the target desktop platform if needed | Candidate visual work was reviewed, but a platform-specific Windows/Chrome open-menu check is not evidenced here. | Manual UI validation; do not infer closure solely from aggregate screenshot review. |

Completed evidence should be added without disclosing private household content. HA calendar sync was already observed successful at 2026-10-29 21:35 UTC, so no TLS renewal action is currently indicated by that old blocker. Provider-mark use rights are confirmed and recorded; no further #19 rights action is pending.
