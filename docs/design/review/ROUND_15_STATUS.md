# Runde 15 – implementeringsstatus

Status: lokalt arbeid pågår, 28. oktober 2026. Kravgrunnlaget er
[ROUND_15_REQUIREMENTS.md](ROUND_15_REQUIREMENTS.md). Dette er en kontrollert
mellomstatus; samlet QA, release gate og offentlig testpublisering gjenstår.

## Kilde og publisert utgangspunkt

- Offentlig testmiljø står fortsatt på R14-kilden
  `971913e321dd82f491214fdbda81d08f8123a891`. Denne runden har ikke endret det
  publiserte miljøet.
- Integrerte lokale kildepunkter: tid `84f51f7`, skole `3a15602` og
  skjermoppsett/ICS/skolepresentasjon `d4490a5`.
- Neste-paritet og historikkretting er kontrollert lokalt etter disse punktene;
  integrering håndteres av hovedagenten.

## Kontrollerte leveranser

| Område | Resultat | Avgrensning |
|---|---|---|
| Tidsregler for personkort | 40 tester og web-typekontroll bestått | Husholdningstidssone, eksklusive sluttider og levende klokke. |
| Skole/proveniens | 153 tester og API-typekontroll bestått | Eksplisitt produsentkjøring, trygg diagnostikk, lagret utløp og kildeforankrede praktiske råd. |
| Skjermoppsett og ICS-hjelp | 13 målrettede tester og typekontroll bestått | Separate valg for innhold, personbilder/fødselsdager, kildetilgang og åpning. |
| Neste og historikk | 11 API-tester og hele webpakken, 159 tester, bestått | Avlyste/avslåtte aktiviteter filtreres før paginering; tidsbestemte nullvarighetshendelser er punkter, mens ugyldige heldagsintervaller avvises. |

Den tidligere integrerte webfeilen i Round 12s DST-overlappstest er rettet ved å
gjenopprette dagshistorikk som standard. Personkort bruker fortsatt den
uttrykkelige regelen for aktuelle aktiviteter. Dags-/ukehistorikk beholder
avsluttede rader; Neste viser ett gyldig pågående eller kommende element.

## Faktisk skolediagnose

Det ene eksisterende oppdraget feilet i endelig JSON-/skjemavalidering. Rått
modellresultat ble ikke lagret, så den konkrete avvikende strukturen kan ikke
rekonstrueres fra bevisene. HTTP-suksess og registrert modellbruk beviser ikke et
gyldig sluttresultat.

Det andre oppdragets eldre feil er en generell feil fra før R14 uten lagret
trinnforklaring. Årsaken er ukjent; den er ikke bekreftet som en leverandørfeil.
Den bekreftede programvarefeilen i provenienskoblingen er rettet for nye resultater.
Eldre resultater får ingen gjettet kobling eller omskrevet historikk.

Visningsmetadata er fortsatt ikke aktivert for disse oppdragene. Eierens
eventuelle skolevisningsvalg er adskilt fra feilretting. Ingen nye modellkall,
kopier, godkjenninger, tidsplaner eller delingstilganger er innført som del av
diagnosen.

## Migrasjon og gjenstående arbeid

Migrasjon 042 legger til en valgfri produsentkjøring med fremmednøkkel innenfor
samme oppdrag. Eksisterende verdier forblir `NULL`; proveniensen vises som ukjent
til en legitim ny resultatkjøring oppretter koblingen. Migrasjonen er bare kjørt
mot isolert testdatabase i denne kontrollen. Offentlig migrasjon krever fortsatt
rundens backup-/restore-bevis. Foretrekk applikasjonsrollback; destruktiv
skjemanedgradering er ikke en automatisk rollback.

Visuell Home-gjennomgang og skjermbilder, samlet sikkerhets-/krav-/UX-kontroll,
full QA, release gate, kilde-/imagebinding og offentlig testpublisering med HTTPS-
kontroll gjenstår. Privat bakgrunn og ekte konto-/oppdragskonfigurasjon skal
bevares. Loggene ligger i ignorert lokal lagring; ingen privat husholdningsdata
eller hemmeligheter er lagt til i kilde- eller dokumentasjonsfilene.

## Nyeste lokale checkpoint

Skjerm-/ICS-flyten er integrert i `d4490a5`, Next/historikk i `cd53080`, og skjermforhåndsvisningens kontekst i `e21e1b8`. Sikkerhetsreview av Next-rettingen er PASS. Home-komposisjon, tomme seksjoner og skoleferskhet er nå implementert; 19 målrettede tester og web-typekontroll bestod. Hovedagenten kjørte hele webpakken etter integrasjon: 164/164, ingen feil/skips. Faktisk geometri, før/etterbilder, samlet slutt-QA, backup/restore og offentlig R15-publisering gjenstår. Offentlig drift er fortsatt R14.

## Pågående utvidelse 16–19

Brukeren utvidet samme mål etter at tidligere utviklingspakke var implementert og 546 tester bestod. Nye issues 16–19 er lest; krav og ansvar er lagt til i samme matrise. Pågående capture-/opsforberedelser bevares, men er ikke sluttgodkjent for den utvidede kandidaten. Offentlig drift er fortsatt R14, uendret. Skrivearbeid fortsetter sekvensielt: A ICS, B skjermbackend, C skjerm-UI, D logoressurser; fagreview og lokalt QA følger integrasjon. R14-fallback må erstattes med ny policykompatibel gjenoppretting før 043/044 tas i drift.
