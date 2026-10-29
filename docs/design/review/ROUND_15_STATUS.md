# Runde 15 – implementeringsstatus

Status: lokalt arbeid pågår, 28. oktober 2026. Kravgrunnlaget er
[ROUND_15_REQUIREMENTS.md](ROUND_15_REQUIREMENTS.md). Dette er en kontrollert
mellomstatus; samlet QA, release gate og offentlig testpublisering gjenstår.

## Nyeste kontrollpunkt: asynkron skjermtilgang rettet

Den avgrensede sterkere rettingen er implementert. Innløsning, eksplisitt
frakobling, felles kildeidentitet og cacheendringer koordineres gjennom samme
nettleserlås. Gamle svar, ACK-er og alle SSE-callbacks kontrollerer både lokal
generasjon og gjeldende felles kilde. Vellykket innløsning publiserer skjerm-ID
før låsen frigjøres; en ventende gammel frakobling sender ikke POST mot ny
legitimasjon. Forsinkede hendelser kan ikke bare slette en nyere cache.

Kjent tilgangsendring under henting (409) skjuler gammelt innhold med én
avgrenset straksretry, uten ny paring. Anonym førstegangs-401 klassifiseres
som ukoblet, ikke som bekreftet tilbakekalling. Nettverks-/kroppslesefeil blir
status-0-feil; HTTP-status og tap av låseierskap beholdes separat. Disse
påstandene er lokalt testet mot produksjonskoordinatoren med syntetiske data;
faktisk flertab-/to-nettleserbevis gjenstår. Ingen absolutt garanti gis ved
frosset/krasjet nettleser eller allerede levert Set-Cookie.

Hovedagenten har kontrollert fullutskrifter, exit-koder og kildehasher:
**389 API-tester og 199 webtester består**, uten skips. API-ens 170 oppføringers
kildemanifest var likt før/etter og er fortsatt identisk etter frontendendringene.
Web-typekontroll og fokuserte koordinator-/responsfeiltester består. Dette er
ikke en samlet releasegodkjenning; faktiske appbilder, fagreview, gjenoppretting
og offentlig publisering gjenstår. API- og webkodens verifiserte deltrær kan
gjenbrukes uten ny fullkjøring dersom de ikke endres.

## Nyeste kontrollpunkt: leverandørlogoer #19

Offisielle, uendrede lokale ressurser for Google Kalender, Outlook, Spond og
Home Assistant brukes i eksisterende kalenderflyt. Spond/HA-kortet har begge
merkene; ICS beholder generisk ikon. Synlige navn og dekorative bilder er
separate, uten eksterne bildekall. Kilde-/rettighetskontekst og SHA-256 står i
`apps/web/src/assets/calendar-providers/PROVENANCE.md`.

31 målrettede tester og web-typekontroll bestod. Etter hovedreview ble en
CSS-spesifisitetsfeil i lys Spond-variant rettet. Faktisk Chromium-komponenttest
med React-markup, originale bilder og appens CSS bekrefter én synlig variant i
begge temaer; to ressurs-/tilgjengelighetstester og ny typekontroll består.
Dette er komponentbevis, ikke visuell godkjenning av de ferdige appsidene.

Resterende asynkrone skjermfunn er bekreftet av sterkere review: kjente lokale
referanser alene beskytter ikke mot en nyere felles nettleserkobling. Neste
avgrensede skriver retter koordinering av innløsning, eksplisitt frakobling,
publisering av kildeidentitet og sene svar. Ingen runtime er oppdatert ennå.

## Nyeste kontrollpunkt: skjerm-UI og ekstern HA-hindring

UI for #17/#18 er implementert lokalt: gjenkobling av eksisterende registrering,
kompakte språk-/utseendevalg med arv, separate personvalg per enhet og oppsett,
og uttrykkelig overgang fra eldre bursdagsbegrensninger. Bursdager fungerer
uavhengig av profilroster og egne personkort. Web-typekontroll og 32 målrettede
tester består. Hovedagentens review har likevel funnet gjenværende asynkrone
grenseflater mellom faner; en avgrenset sterkere review følger. Dette er ikke
godkjent nettleser-/tilgangsbevis. Ingen ekte skjerm er brukt som test.

Lesende kontroll fra den eksisterende offentlige appen bekreftet en ekstern
HA-hindring: sertifikatet på det konfigurerte målet utløp 7. april 2026 kl.
22.00.23 UTC. Samme første DNS-mål som HA-klienten bruker ble kontrollert;
TLS-valideringen gir CERT_HAS_EXPIRED. Sertifikatsjekken sendte verken HTTP-
forespørsel, innlogging eller kalenderdata. Appens vanlige TLS-validering,
HA-konfigurasjon, tilkobling og hemmeligheter er uendret. Lagret tilgangstoken
var utløpt; ingen tokenfornyelse eller ny autorisasjon ble startet. Eieren må
fornye sertifikatet i den eksisterende HA-/proxy-driften før ekte synk kan
kontrolleres videre. Dette er adskilt fra Samvev-kode og blokkerer ikke resten.

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


## Endelig checkpoint – 2026-10-29 13:07:49 UTC

Kandidatkilden er `05cf86dc83ab70070b7050b2c25fa71cff6380bb`. Kriteriene #16–18 er implementert. Endelig QA er ferdig: isolert API-suite 437/437 (0 feil), web 207/207, contracts 7/7, core 3/3 og web-typekontroll PASS. Source-05cf funksjonell nettleserkontroll bestod 14/14. UX- og sikkerhetsreview er PASS; kravreview er betinget GO. Isolert offentlig clone restore-gate er PASS (`.local/m3/round15/ops/public-restore-20261029T132214Z/result.private.json`). Offentlig cutover kjører fortsatt, så publisering er ennå ikke bekreftet.

### #19 og skoleoppdrag

#19s faktiske logoer er ikke levert: rettighetsgrunnlag mangler. Kandidaten viser generiske kodebaserte symboler sammen med synlige navn. Ikke registrer logoressurser før eier har fremlagt rettighetsbevis.

Skoleoppdrag A feilet i endelig JSON/schema-validering. Kildedata lagrer ikke råmodellresultatet, så avviket kan ikke rekonstrueres. Skoleoppdrag B har en eldre generell feil uten diagnostisk trinnbevis. Ingen av oppdragene er live-reparert, og ingen nye modellkall ble gjort.

### QA-gjenoppretting

En tidligere full test traff ved en feil QA-appen og forkortet den syntetiske QA-databasen. Hovedagenten gjenopprettet framover fra 00:08-backup inn i schema 45 etter isolert donor-/testrestore. Kontroller omfattet 86 tabellhashverdier/FK-er, AI-rater og ledger, login/`me` 200 samt app-/worker-helse. QA-endringer etter backup kan mangle. Offentlige data ble ikke berørt.

### Offentlig status og visuelle bevis

Offentlig testmiljø er fortsatt R14 mens cutover kjører. R15 er **ikke bekreftet publisert**. Etter at cutover-resultatet foreligger, oppdateres dette avsnittet med tidspunkt, source SHA, immutable image digest, migrasjons-/restorebevis og offentlig HTTPS-/syntetisk akseptresultat. Clone restore-gate PASS alene er ikke bevis på publisert runtime.

Siste issuesjekk kl. 13:07:49 UTC fant ni åpne issues og ingen nye kommentarer. Ingen issue ble kommentert eller lukket. Syntetiske finalbilder ligger i lokale evidence-output-kataloger; publisert `latest/` har 14 hashverifiserte, personvernmaskerte PNG-er fra seks-personers Round ID `20261029134403-05cf86dc-28ee8faa`; manifestets source SHA er `05cf86dc83ab70070b7050b2c25fa71cff6380bb`. Manifestets LAN-origin og demo-kontolabel er fjernet. Ingen privat nettleserbilder, hemmeligheter eller ekte husholdningsdata ble lagt i Git.


## Offentlig cutover – 2026-10-29 13:35:05 UTC

Den delvise R15-kandidaten er nå publisert; cutover completion receipt har mtime 13:35:05 UTC. Source/deploy SHA er `05cf86dc83ab70070b7050b2c25fa71cff6380bb`; immutable image er `sha256:20a587bbc1f8630afdbb02be881ef97f996ae8ee58eaa14c1c7112afdaf61e10`. Databaseskjema gikk fra 41 til 45. Fersk quiescent backup, pre-/post-cutover isolerte restore-gates og helse for app, worker og database bestod. Data-, vault- og konfigurasjonshasher ble bevart. Cutoverbevis: `.local/m3/round15/ops/cutover-20261029T133220Z/result.private.json` (cutover run directory; completion receipt mtime 13:35:05 UTC).

Offentlig HTTPS Playwright-smoke bestod 11/11. Syntetisk innlogging og navigasjon på desktop/mobil, anonyme sider, asset-hasher, ICS UI, People, AI og utlogging bestod. Ingen ikke-autentiseringsmutasjoner ble observert. Health og rutene `/om`, `/personvern`, `/vilkar` og `/display` svarte 200. Nettleserbevis ligger i `.local/m3/round15/public-browser/postdeploy-smoke.json` (mode 600).

Dette er en begrenset R15-publisering med fortsatt eierarbeid: #19-logoer er ikke levert mens rettighetsgrunnlag mangler; skoleoppdrag A/B er ikke live-reparert; Google/Microsoft-samtykke/registrering, utløpt HA TLS-endepunkt, privat ICS-kontroll, skolevisningsvalg og fysisk iPad/Shelly/ekte skjerm er fortsatt åpne. QA-resultatene og QA-databasehendelsen er dokumentert ovenfor; ingen offentlig data ble berørt av den QA-hendelsen.
