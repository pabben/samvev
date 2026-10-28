# Runde 15 – implementeringsstatus

Status: lokalt arbeid pågår, 28. oktober 2026. Kravgrunnlaget er
[ROUND_15_REQUIREMENTS.md](ROUND_15_REQUIREMENTS.md). Dette er en kontrollert
mellomstatus; samlet QA, release gate og offentlig testpublisering gjenstår.

## Nyeste kontrollpunkt: skjermbackend #17/#18

Backend med additive migrasjoner 043/044 er implementert og kontrollert lokalt.
Gjenkobling bevarer registrering, oppsett og delinger; vellykket innløsning roterer
legitimasjon og stenger gammel API-/SSE-tilgang. Endelige lesesvar kontrollerer
legitimasjonen på nytt. Handlinger beholder eksisterende serviceautorisasjon og
avgrensede kvitteringer, også når en faktisk tilstand ikke kan bekreftes.

Bursdager har off/all/legacy_selected med begrensningsbevarende migrering.
Personvalg kan overstyres per enhet uten å endre delt oppsett eller gi nye
profil-/kalenderrettigheter. Rå valg, arv og effektive verdier er separate i
administratorens API. Klarstatus kontrollerer deling av den nøyaktige valgte
kalenderkilden; gyldig husstandskalender krever ikke et personvalg.

Full API-kjøring bestod 388/388 etter retting av handlingskvittering; contracts
bestod 7/7 og typekontroller bestod. Deretter ble en avgrenset feil i klarstatus
rettet: 8/8 policytester og API-typekontroll bestod på ny kilde. Det eldre
388-resultatet er derfor bevis før denne siste rettingen, ikke endelig samlet
QA. Se [API-/UI-overlevering](../../implementation/ROUND_15_DISPLAY_API.md).
UI, faktisk to-nettleserflyt, endelig full QA, bilder, restore og publisering
gjenstår. Ingen reell skjerm er koblet om som test.

En ny lesende kontroll av offentlig R14 viste HA-synkfeil, med siste vellykkede
oppdatering 28. oktober kl. 20.13 UTC. Dette er en observert eksisterende status,
ikke en R15-regresjon eller en live-godkjenning av HA. Kilder, hemmeligheter og
delinger er ikke endret. Videre kontroll holdes adskilt fra syntetisk testing.

## Nyeste kontrollpunkt: kalenderfeil #16

Samme pågående runde omfatter nå #16–#19. Kalenderrettingen er implementert
lokalt og gjennomgått av hovedagenten. webcal/HTTPS bruker samme pinnede
SSRF- og omdirigeringsvern. Historiske avtaler utenfor vinduet fyller ikke
forekomstgrensen; parsing har egne avgrensede arbeidstråder. Den fulle lagrede
ICS-adressen kan leses og endres av husstandsadministrator, med kryptering,
aktiv økt-/rettighetskontroll og revisjons-/generasjonsvern. Deltakere og
skjermer mottar ikke adressen. Kalenderlenker som havner i AI-overvåking får
egen, lagringsbestandig veiledning før modellarbeid starter.

Målrettet lokal kontroll: 36 parser-/kildetester, 33 monitoragenttester,
6 kalender-API-tester, 4 kalenderflyttester, 9 feilpresentasjonstester og
1 faktisk Chromium-test av skjermbildemaskering bestått. API- og webtypekontroll
bestått. FotMob-eksemplet ble hentet gjennom standardtransport/parser med både
webcal og HTTPS: 29 179 byte og 26 hendelser i begge tilfeller. Dette beviser
ikke årsaken til en utilgjengelig privat kalenderfeil. Køgrensen er testet;
utløst parserfrist og faktisk heap-uttømming er ikke testet.

Skjermbackend #17/#18 er neste sekvensielle skriveoppgave, deretter UI og
leverandørlogoer. Samlet QA, faktiske syntetiske før-/etterbilder, ny restore-gate
for 041→044 og offentlig publisering gjenstår. Offentlig source er fortsatt R14.
Ingen skjermregistrering, reell kalender, tidsplan eller tillatelse er endret
som test.

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
rundens backup-/restore-bevis. Etter 043/044 er R14-applikasjonsrollback utrygg:
den overser nye skjermbegrensninger. Bevar databasen og rett backend fremover;
eventuell UI-fallback krever et særskilt verifisert policykompatibelt kildepunkt.
Destruktiv skjemanedgradering er ikke en automatisk rollback.

Visuell Home-gjennomgang og skjermbilder, samlet sikkerhets-/krav-/UX-kontroll,
full QA, release gate, kilde-/imagebinding og offentlig testpublisering med HTTPS-
kontroll gjenstår. Privat bakgrunn og ekte konto-/oppdragskonfigurasjon skal
bevares. Loggene ligger i ignorert lokal lagring; ingen privat husholdningsdata
eller hemmeligheter er lagt til i kilde- eller dokumentasjonsfilene.

## Nyeste lokale checkpoint

Skjerm-/ICS-flyten er integrert i `d4490a5`, Next/historikk i `cd53080`, og skjermforhåndsvisningens kontekst i `e21e1b8`. Sikkerhetsreview av Next-rettingen er PASS. Home-komposisjon, tomme seksjoner og skoleferskhet er nå implementert; 19 målrettede tester og web-typekontroll bestod. Hovedagenten kjørte hele webpakken etter integrasjon: 164/164, ingen feil/skips. Faktisk geometri, før/etterbilder, samlet slutt-QA, backup/restore og offentlig R15-publisering gjenstår. Offentlig drift er fortsatt R14.

## Pågående utvidelse 16–19

Brukeren utvidet samme mål etter at tidligere utviklingspakke var implementert og 546 tester bestod. Nye issues 16–19 er lest; krav og ansvar er lagt til i samme matrise. Pågående capture-/opsforberedelser bevares, men er ikke sluttgodkjent for den utvidede kandidaten. Offentlig drift er fortsatt R14, uendret. Skrivearbeid fortsetter sekvensielt: A ICS, B skjermbackend, C skjerm-UI, D logoressurser; fagreview og lokalt QA følger integrasjon. R14-fallback må erstattes med ny policykompatibel gjenoppretting før 043/044 tas i drift.
