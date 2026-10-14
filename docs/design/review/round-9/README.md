# Runde 9 – reviewgrunnlag

Dette katalogtreet er tilleggsevidens for runde 9. Den ordinære review-runden
er fortsatt [latest](../latest/manifest.json), med round ID
`20261014052355-6f9f5c50-3f5e1278` og kilde
`6f9f5c50478b680c0c435d782f2a5d99e8a1ed9e`.

`six-home/` er den isolerte, ekte seks-personers hovedfixturen: to voksne og
fire barn, kun fiktive data. Den er normaltilstanden for designvurdering.
`count-stress/` er eksplisitt injiserte responsobjekter for 1–3 personer og
tomt innhold; den beviser responsiv presentasjon, ikke lagring eller provider.
`photo/`, `calendar/`, `tasks/`, `ai/` og `messages/` viser reelle UI-flyter
mot den isolerte Samvev-applikasjonen. `new-flow-manifest.json` beskriver de
44 berørte-flyt-bildene og deres avgrensning.

`public/` er en separat, sanert offentlig HTTPS-receipt: 63 faktiske kontroller
bestod mot `https://samvev.pabben.org/`, og 50 trygge kontrollbilder ble
publisert. Tolv operatørbilder er private. Kalenderleverandører og ChatGPT ble
ikke kontaktet i denne kontrollen.

`comparison/` legger de autoritative referansene, runde 8 og runde 9 ved siden
av hverandre for sporbar designvurdering. Det er en avledet sammenligning, ikke
et ekstra UI-opptak og ikke en godkjenning av visuell likhet.

De autoritative designreferansene forblir:

- `docs/design/ChatGPT Image 24. sep. 2026, 23_51_09.png`
- `docs/design/ChatGPT Image 24. sep. 2026, 23_52_06 (4).png`

Bildene er reviewevidens, ikke en erklæring om pixel-likhet eller endelig
eiergodkjenning. Se [ROUND_9_REPORT.md](../ROUND_9_REPORT.md) for levert
atferd, testavgrensninger og nødvendige eierhandlinger.
