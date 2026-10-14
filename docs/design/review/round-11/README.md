# Kalender-GUI/HA-reviewbevis

Dette er implementeringspakken fra mailbox `23c01cc`, ikke en ny generell designrunde.

- `../latest/manifest.json`: 14 maskerte bilder fra bevart LAN-demo, sluttkilde `585a7204ce89bc7e953f6b79cf871c1845a12f9f`.
- `final-ui/manifest.json`: målrettet faktisk UI med seks fiktive personer, administratoroppsett, private leservalg, stale/feil/gjenoppretting og rettet heldagsvisning. Samme sluttkilde, egen fixture-seed-SHA.
- `dark-ui/manifest.json`: sju EN/mørk-bilder av administrator-dialoger, mobil person-/leservalg og seks-personers Home på desktop/iPad/Shelly; sluttkilde 585a720.
- `initial-flows/manifest.json`: innledende syntetiske Google/Microsoft/HA OAuth-/previewflyter på kilde `1a10e77`, før visuelle rettelser. Ikke sluttkildebilder.
- `checks/`: sanitized kilde-/image-/asset-/test-/bevarings-/restore- og offentlig R10-baselinebevis. Ingen privat konfigurasjon, backup, token, kalenderinnhold eller personnavn.
- `../ROUND_11_REPORT.md`: leveransegrenser, eierhandlinger og rollback.

Bildene er ekte Samvev-UI. Ekstern leverandørtransport i isolert fixture er syntetisk; disse bildene beviser ikke virkelig Google/Microsoft/HA-autorisasjon eller synk. Den offentlige HTTPS-kontrollen gjelder eksisterende R10, ikke publisering av kandidaten.

Primære designreferanser er fortsatt:

- `docs/design/ChatGPT Image 24. sep. 2026, 23_51_09.png`
- `docs/design/ChatGPT Image 24. sep. 2026, 23_52_06 (4).png`

Senere 14-bilders review kjøres eksplisitt med `bash scripts/design-review.sh` etter et verifisert kildecheckpoint, runtime og bygg etter review-README. NEXT_CODEX_PROMPT.md auto-eksekveres ikke.
