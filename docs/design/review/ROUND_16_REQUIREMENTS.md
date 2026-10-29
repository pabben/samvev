# Round 16 – krav- og evidensmatrise

## Gjeldende checkpoint – 2026-10-29

Kandidatkilde er `ec3413ec232e51a0d55a21460cb7ee16b5e99a9a`; offentlig testmiljø står fortsatt på `05cf86dc83ab70070b7050b2c25fa71cff6380bb`. Kandidaten er ikke publisert. QA, visuell kontroll og eventuell distribusjon gjenstår. R15-rapportene beskriver historiske kontrollpunkter og er ikke gjeldende R16-status.

Matrisen skiller kildeimplementasjon fra syntetisk kontroll, offentlig observasjon og handlinger som krever eierøkt. Ingen ekte skoleoppgave er reparert eller endret.

| Område | Implementert / kildebevis | Verifisert status | Åpent / avgrensning |
|---|---|---|---|
| R13–R15 baseline | Familiehub, personfarger/-kort, bilder, bursdager, boards, skjermhandlinger, kalender-/delingsrettigheter og person-/skjermvalg er del av kandidaten. R13–R15 status- og rapportdokumenter samt `docs/implementation/M1_STATUS.md` gir historisk kilde- og kontrollspor. | Tidligere runder har syntetiske tester og avgrenset offentlig kontroll; ikke nytt R16 QA-bevis. | R16 full QA/visuell gjennomgang og kandidatens publiseringsbeslutning venter. Historiske «levert» gjelder sine SHA-er, ikke automatisk kandidaten. |
| Kjøleskap / forhåndsvisning / tilgang | R16-fridge, preview og tilgangsarbeid finnes i kandidatens kilde; eksakt scope skal kontrolleres mot kandidatdiff og QA. | Offentlig skrivebeskyttet observasjon: 14 kort, seks profiler/bursdager, null source display targets, false board read grants, null HA control entities. Ingen automatisk deling. | Ikke utled funksjonell aksept fra observasjon alene. Tilgangsgrenser må bestå kandidatens syntetiske og sikkerhetskontroller. |
| School task A/B | Sikker diagnose-/presentasjonsflyt er i kandidatsporet; se source/test-bevis i round-16 rapporter når QA ferdigstiller. | A: siste observerte resultat `final_schema/schema_mismatch`. B: siste `AI_UPSTREAM_ERROR` etter vellykkede verktøy. Historisk råårsak er utilgjengelig. | Kun trygge diagnostiske observasjoner. Ingen bekreftet rotårsak eller reparasjon; ingen endring av oppgave, godkjenning, historikk eller plan. Bruk bare generiske betegnelser «school task A/B». |
| Design og referanse | Referanseledet Home/Calendar og tidligere layoutarbeid er i kildehistorikken; se `docs/design/review/round-14/README.md` og R15 designbevis. | Eldre syntetiske bilder finnes for tidligere SHA-er. | Round-16 visuell vurdering/screenshots venter; tidligere bilder beviser ikke nåværende kandidat eller fysisk panel. |
| Issues #3, #12–#19 | Historiske krav og implementasjonsnotater finnes i R13–R15-matrisene og leveranserapportene. | Ikke hevdet lukket eller fullført i Round 16 uten fersk kontroll. | #3 temakontrast; #12 fysisk Shelly/iPad; #13–15 tidligere familie-/kalenderoppfølging; #16 kalenderkilde; #17–18 skjerm; #19 leverandørlogoer. Faktiske logoer holdes ute inntil bruksrett er bekreftet; generiske symboler/navn brukes. |
| Historiske funksjoner | Bursdager, utløp av tidsbaserte aktiviteter, personfarger, bilder, boards, skjermhandlinger, OAuth, Home Assistant og ICS har tidligere kilde- og testbevis. | HA-kalender viste vellykket synk 2026-10-29 21:35 UTC i offentlig read-only kontroll; eldre TLS-blokkeringspåstand er utdatert. | Dette bekrefter ikke nåværende R16 full QA, eierens OAuth-samtykke, private ICS-validering eller HA-kontrollhandlinger. Ingen HA-kontrollenheter er eksponert i observert kjøleskap. |
| Personvern / publisering | Ingen ekte navn, private data, URL-er, tokens eller logoaktiva skal legges til dokumentasjon. | Offentlige observasjoner er aggregert og generisk gjengitt her. | Ikke publisert. Offentlig kilde fortsatt `05cf86d`; kandidat `ec3413e`. QA, UX/visual, sikkerhet/kravreview og deploy-gate må dokumenteres før ny publisering. |

## Evidence index

- Historisk R15-kontekst: [ROUND_15_REQUIREMENTS.md](ROUND_15_REQUIREMENTS.md), [ROUND_15_STATUS.md](ROUND_15_STATUS.md), [ROUND_15_REPORT.md](ROUND_15_REPORT.md).
- Historisk R14 visuelt bevis: [round-14 README](round-14/README.md); gjelder SHA i R14-dokumentasjonen.
- Gjeldende checkpoint og utestående gates: [M1 implementation status](../../implementation/M1_STATUS.md).

Statusord: **implemented** betyr at kildekode finnes; **synthetic verified** gjelder kun navngitt testbevis og kilde-SHA; **publicly observed** er read-only inspeksjon av offentlig miljø; **owner-only** krever eierens konto/samtykke; **unresolved** er uavklart eller mangler ferskt bevis. Ingen av ordene impliserer publisering.
