# Runde 14 – gjeldende kravmatrise

Publisert source `971913e321dd82f491214fdbda81d08f8123a891`. Denne matrisen erstatter de historiske mellomstatusene; se [rapporten](ROUND_14_REPORT.md) og [testbevis](ROUND_14_TEST_EVIDENCE.json).

Issues #13, #14 og #15 ble lest i sin helhet. Oppstartsvinduet var 2026-10-26T23:29:24Z–2026-10-27T23:29:24Z; ingen andre nye relevante issues eller kommentarer ble funnet. Ny metadatakontroll 28. oktober fant ingen endringer. Private navn fra issuebeskrivelser er ikke kopiert hit.

| Krav | Implementasjon / kontroll | Status / gjenstående |
|---|---|---|
| Referanseledet design på alle sider | Felles tokens/flater, forsidekomposisjon, meldinger, navigasjon, skjemaer, mobil og begge temaer. Nettbrett- og tomromsfunn rettet. Ekte bilder åpnet av hovedagent/UX. | Implementert og syntetisk kontrollert. Endelig UX/releasegodkjenning bestått; offentlig navigasjon og endrede flater kontrollert. |
| #15 kompakt kalender | Tid/heldag, status og tittel; detaljer med trykk/tastatur; synlig avlysning; serverlagrede farger med tilgangskontroll. Seks ulike standardfarger og deterministiske flerperson-/husstandsvarianter. | Implementert, API-/UI-/nettlesertestet. Offentlig kalender/tomtilstand kontrollert. Personfargeredigering kontrollert syntetisk; offentlig testkonto manglet redigeringsrettighet. Paletten har 12 farger; senere personer kan gjenbruke farge. |
| #14 ICS som enkel inngang | Eksisterende motor, veiledning, forhåndsvisning, separate personer/lesere/skjermer, aktivering, 15-minutters standard og 5/30-valg, oppdater nå og sannferdig status. | Faktisk UI testet med syntetisk kalendertransport, inkludert feil som bevarer siste gyldige innhold og gjenoppretting. Privat eierkalender er ikke live-verifisert. |
| #13 Claude | Kryptert nøkkel, modellvalg, avgrenset test, typed feil, faktisk brukt rute/modell, eksplisitt reserve og UTC-forespørselsgrense. | Adapter/API/UI/reserve/grenser syntetisk testet. Ingen ekte nøkkel eller modellforespørsel brukt. Offentlig oppsettsvisning kontrollert uten lagring/modellkall. |
| Bevar R13 | Bursdager/bilder, dag/tomorrow/uke/neste, skolemetadata, skjermer/handlinger, album, lister/middager, HA/T1–T3 og offentlige sider. | Full regresjon 526/526; ingen eksisterende reelle oppdrag, rettigheter, persondata eller fysiske enheter endret av tester. Faktisk offentlig bevaring kontrollert ved cutover, inklusive gamle verdier, volum, vault og runtimeinnstillinger. |
| Review og drift | Isolert bygg, kilde-/runtime-/distbinding, QA admin/admin, 14 kanoniske bilder, sikkerhetsreview, isolert offentlig restore 037→041 med 28 kontroller. | Kontrollert. Endelig visuell gate og releasegate bestått; offentlig utrulling, ny backup/restore og HTTPS-kontroll bestått. |
| Eierhandlinger | Google/Microsoft-samtykke, privat abonnement, skolevisning og ekte Anthropic-test. | Separate, ikke generelle utviklingsblokkeringer; se [konkret liste](ROUND_14_OWNER_ACTIONS.md). |

Syntetiske resultater beviser ikke ekte ekstern kontotilkobling eller synk. Ingen nye fysiske HA-tester inngår i releasekravet.
