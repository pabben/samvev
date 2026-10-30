# Round 17 — remaining owner actions

Public test deployment, HTTPS smoke, and isolated restore passed for the R17 source. Issue #21’s synthetic shared date-window behavior is verified, but neither substitutes for private account, source, or hardware validation.

| Action | Boundary |
|---|---|
| Grant Google Calendar consent, if the owner chooses to connect it | Open [Integrasjoner](https://samvev.pabben.org/?tab=integrations), choose Google Kalender and follow the account connection. Owner account consent is required; do not use a private calendar as synthetic test data. |
| Complete Microsoft app registration/consent, if the owner chooses Outlook | Open [Integrasjoner](https://samvev.pabben.org/?tab=integrations), choose Outlook/Microsoft 365 and follow the administrator setup before connecting an account. Owner-controlled tenant/application registration is required. Keep secrets out of Git and reports. |
| Validate the private ICS source (#16) | Open [Integrasjoner](https://samvev.pabben.org/?tab=integrations), choose «Legg til kalender med lenke», preview the owner-controlled source, then inspect sync status. Keep URLs, credentials, and private event content out of reports and logs. |
| Check issue #3 theme-menu behavior in Chrome on Windows | Open [Innstillinger](https://samvev.pabben.org/?tab=more) in Chrome on Windows and inspect the **open** theme menu in both modes. General screenshots do not establish this platform result. |
| Validate the actual Shelly/iPad or paired target display (#12) | Open [skjermvisningen](https://samvev.pabben.org/display) on the physical device and compare it with the chosen setup under [Skjermer](https://samvev.pabben.org/?tab=displays). Synthetic viewport screenshots are not hardware acceptance. |
| Review the actual fridge/display source and board grants | Open [Skjermer](https://samvev.pabben.org/?tab=displays), select the existing target display, review intended calendar sources and board permissions, approve sharing explicitly, then compare preview with the real paired projection. Do not broaden grants automatically; R17 used synthetic data only. |
School tasks A and B remain unresolved engineering work, not owner actions. Preserve their existing approvals, schedules, history, and content; no raw source data or model calls were used in this review. The active user background is unchanged, and the original source is preserved.
