# Runde 9 — personbilder, kalendere og personknyttede oppdrag

Mailbox: `74eeaabf4133b457b86a2f16acd61e046a754af8`.

Kilde som denne rapporten beskriver: `6f9f5c50478b680c0c435d782f2a5d99e8a1ed9e`.
Det immutable runtime-imaget er
`sha256:3ad404184a793cf73a8436fc8498441d2f9cf6937ca2f10ab7087326be846453`.
Rapporten inneholder aldri personnavn, kontoidentifikatorer, kalenderlenker,
passord eller andre private verdier.

Review-SHA er med hensikt ikke forhåndsutfylt her: den er den DCO-signerte
featurebranch-commiten som inneholder denne rapporten og registreres først når
den commiten finnes. Det er ikke en ny UI-kilde-SHA.

Offentlig test åpnes på <https://samvev.pabben.org/>. Etter innlogging med egen
autorisert konto er direkte innganger
[Personer](https://samvev.pabben.org/?tab=people),
[Integrasjoner](https://samvev.pabben.org/?tab=integrations),
[AI](https://samvev.pabben.org/?tab=ai) og
[Oppdrag](https://samvev.pabben.org/?tab=monitors).

## Levert i kilden

Personbilder er egne, beskyttede data på personen, også når personen ikke har
en konto. Den autoriserte redigeringsflyten støtter valg, beskjæring, lagring,
bytte og fjerning. API-et validerer reelt bildeinnhold og størrelse, fjerner
EXIF, normaliserer til WebP-varianter og håndhever tilgang på de versjonerte
bilde-URL-ene. Illustrasjon og initialer er fortsatt fallback.

Google Calendar, Outlook/Microsoft 365 og ICS har lesende kalenderflyter med
konto-/kildevalg, person- og visningsavgrensning, forhåndsvisning og aktivering.
Synktilstand, revisjoner, leases, sider, retry, tidssoner, gjentakelser,
avlysninger og gjenopprettede forekomster er testet isolert. Spond er en
tydelig merket kalenderbro via en eksisterende Google- eller Outlook-kilde;
den påstår ikke direkte Spond-API, meldinger, oppmøte eller svar.

AI-oppdrag har separat, revidert og auditert metadata for hvem oppdraget
gjelder. Det er ikke det samme som publiseringsmål eller teksttolkede navn.
Personflater viser en serverfiltrert status/resultatvisning uten å utvide
lesetilgang. To eksisterende private oppdrag ble koblet til riktig person kun
gjennom denne metadataflyten. Identitet, historikk, mottakere, leverandør,
godkjenning og godkjent tidsplan ble bevart; det ble ikke laget kopier eller
utført tolkning, modellkall eller manuell kjøring.

ChatGPT-veiviseren skiller runtime-beredskap fra brukerens samtykke, privat
lokal companion/overføring, import og faktisk modellbruk. Google Kalender er
uavhengig av AI-abonnement. Gemini/Google som modellleverandør er vurdert og
ikke implementert; ingen automatisk bytte eller betaling er aktivert.

Designarbeidet omfatter seks-personers hovedfixture (to voksne og fire barn),
få-person-/tomtilstander, kompakte personkort, mobil bursdagsflate, tilbakepil,
fokus etter mus/tastatur og leverandørrelevant AI-hjelp. Referansebildene er
fortsatt autoritative. Dette er ikke en påstand om nær identisk design eller
designgodkjenning.

## Kontrollgrunnlag

- Isolert applikasjonstest: 305 tester bestått (API 235, web 62, kontrakt 5 og
  core 3), fem workspace-kontroller og 10 E2E-kontroller. De kjørte på
  `aacb762`, der applikasjons- og pakkeinputene er byte-like med `a99fbce`;
  a99 endrer bare Dockerfile-runtimebygget. `6f9f5c` endrer deretter bare
  host-siden av ChatGPT runtime-wrapperen, dens test og veiledning; faktisk
  import blir fortsatt kjørt med Node i det immutable runtime-imaget. 57
  capture-flyter og 14 ordinære bilder ble faktisk kjørt på 6f. Wrapperens tre
  målrettede tester og Bash-syntaks ble også kjørt på 6f. Avbrutte eller mislykkede foreløpige
  kjøringer er ikke telt som PASS. Worker har ingen egne enhetstester; dens
  oppførsel dekkes av integrasjon og nettleserflyter.
- En tilleggskontroll på 6f bekrefter ekte native 200 % nettleserzoom og
  at alle undersøkte kontroller er tilgjengelige med naturlig scroll og
  trial-klikk, samt separat fokus på skip-lenken; se
  [zoom-reachability.json](round-9/checks/zoom-reachability.json).
- Isolert UI-test dekker bildeopplasting/bytte/sletting/fallback, kalender- og
  Spond-broflyter med syntetisk transport, oppdragets metadata uten dispatch,
  tilgangsfiltrering, NB/EN, temaer, responsive flater, Axe og native
  nettleserresiliens.
- Runde-ID `20261014052355-6f9f5c50-3f5e1278` binder de 14 ordinære
  `latest/`-bildene til denne kilden. `round-9/` inneholder 57 ytterligere
  isolerte bilder av seks-personers hovedflyt, få-person-stress og nye
  funksjoner. Stressbildene er uttrykkelig DTO-injisert presentasjonstest og
  ikke fremstilt som lagret eller ekstern data.
- For publiserbar ordinær LAN-review maskeres dynamisk privat innhold i
  bildeflaten uten å erstatte API-respons. Det isolerte seks-personerssettet
  bruker bare fiktive testdata.
- Uavhengig UX-gjennomgang åpnet alle 75 review-utdata: 14 ordinære og 57
  isolerte UI-captures samt fire avledede sammenligninger. Den siste
  kalenderflaten på mobil/lys ble tatt på nytt gjennom faktisk OAuth-oppsett,
  aktivering og reload, før kontrollert opprydding til null aktive syntetiske
  kalenderkoblinger. Reviewen fant ingen utestående visuell blokkering. Dette
  er ikke eierens designgodkjenning eller en påstand om nær identisk design.
- Endelig sikkerhetsgjennomgang fant ingen utestående privacy-blokkering i
  publiserbart reviewgrunnlag. Dynamisk LAN-innhold er fortsatt maskert i
  ordinære bilder, og isolerte bilder bruker fiktive data.
- En feilaktig lokal testkommando endret LAN-fixturen. Den ble gjenopprettet
  fra eksakt backup og kontrollert med åtte legacy-tabellhasher,
  integrasjonsdata og faktisk `admin/admin` inn-/utlogging. Dette var ikke
  reseeding. Alle 18 meldingsidentiteter, innhold, målgruppe og opprinnelige
  utløp er bevart. Én melding gikk naturlig fra publisert til utløpt ved sitt
  allerede lagrede utløp; revisjonen ble ikke økt og ingen brukerdata ble
  skrevet av gjenopprettingen.
- Etter final cutover svarte LAN-demoen på aktuell 6f-kilde med health OK,
  alle ti serverte webressurser verifisert og faktisk `admin/admin`
  inn-/utlogging. De fem bevarte personene og preferansene var uendret.
- Historisk reviewgrunnlag er bevart: 426 tidligere filer ble kontrollert mot
  baseline, med bare review-README som forventet oppdatert. Runde 8s ordinære
  `latest`-sett er arkivert byte-likt under
  `archive/20261013220837-15d04719-3db04bd7/`. Hovedcheckoutens 229 beskyttede
  Git-filer er uendret.
- Bildebackup/-restore er kontrollert i isolerte PostgreSQL-kloner, med
  direkte BYTEA-sammenligning, native WebP-dekoding, tilgangsgrenser,
  migrasjon 23 som no-op og indekskontroll. Den endelige a99-klonen bekrefter
  også at indeks og alle ti serverte web-ressurser samsvarer med kildebygget.

De saniterte maskinlesbare receipt-ene er
[testsummary](round-9/checks/test-summary.json),
[LAN-kontroll](round-9/checks/lan.json),
[LAN-bevaring](round-9/checks/lan-preservation.json),
[integrasjonsbevaring](round-9/checks/lan-integration-preservation.json),
[offentlig cutover](round-9/checks/public-cutover.json) og
[offentlig HTTPS-kontroll](round-9/public/checks.json). Den saniterte,
publiserbare [AI-diagnosen](round-9/checks/ai-diagnosis.json) erstatter private
driftslogger. Den endelige [post-cutover recovery-receipten](round-9/checks/post-cutover-recovery.json)
er kildebundet til 6f; [a99-receipten](round-9/checks/historical-a99-recovery.json)
er beholdt som historisk bevis.

## Reproduserbar review og testavgrensning

Den ordinære, kildebundne 14-bilders review-runden kjøres sekvensielt slik:

```sh
bash scripts/design-review-runtime.sh
bash scripts/design-review-build.sh
bash scripts/design-review.sh
```

Testkjøring må bruke den dedikerte, isolerte testdatabasen og eksplisitt
`DATABASE_URL`; den må aldri arve eller peke på `qa-db`/LAN-standarddatabasen.
Vanlig workspace-inngang er `npm test`, med API-, web-, kontrakt- og core-testene
som inngår i den dokumenterte, isolerte runden. Denne regelen er skjerpet etter
den gjenopprettede LAN-hendelsen over.

Endringene omfatter API/datamodell og additive migrasjoner `021`–`023`,
kalender-/foto-/oppdragslogikk, webflyter og lokalisering, runtime-pakking,
test-/captureharness og operasjons-/integrasjonsdokumentasjon. Alle tre
migrasjoner har beholdte checksums i ledgeren; det endelige 6f-cutoveret bekrefter schema
23 uten å spille migrasjonene på nytt.

## Offentlig testpublisering

Publisering skjer på den eksisterende offentlige testinstallasjonen, ikke på
LAN-demoen. Første aac-kandidat var API-frisk, men manglet bygget web-dist og
ga derfor rot-404/offentlig 503. Dette var en pakke-feil, ikke en proxyfeil.
Dockerfile i `a99fbce` bygger web-dist i runtime-imaget. For 6f var full
Docker-bygging blokkert av lav lokal diskplass; det endelige immutable 6f-imaget
er en verifisert overlay fra eksakt a99-image med bare de tre faktiske
Git-diff-filene kopiert inn. Kildeinputene, alle ti serverte webressurser og de
tre oppdaterte filene ble hash-verifisert. Dette er ikke en påstand om at en
kanonisk full 6f-Docker-bygging besto. Fremtidig full bygging krever
vertsoperatørens kapasitets-/retensjonsplanlegging utenfor Samvev; ingen bred
prune, sletting av backup eller endring av andre prosjekter ble gjort. Den
endelige 6f cutover-receipten viser schema 23, bevart volum/konfigurasjon/vault/porter,
sunne app- og worker-containere, backup før bytte og samsvar for ti serverte
ressurser. Ingen Pangolin- eller global proxyendring ble gjort.

Den endelige 6f-offentlige HTTPS-suiten besto 63 kontroller og genererte 62
kontrollbilder ved `2026-10-14T05:32:27.924Z`. Den kontrollerte faktisk
innlogging med den beholdte syntetiske kontoen, navigasjon i lys/mørk og
desktop/mobil, CSP/Origin/CSRF, SSE-heartbeat, logout, bevaring av eget
syntetisk profilbilde og beskyttede bildevarianter, valg/beskjæring/avbryt og
at LAN-demoens `admin/admin` avvises offentlig. Suiten gjorde
ingen providerkall, feil eller page errors. De publiserbare bildene blir filtrert
separat fra private operatørbilder. Eksterne kontoer/kilder er aldri bekreftet
bare av syntetisk transport. Den første faktiske offentlige bildelagringen
skjedde på a99; 6f-kontrollen beholdt dette bildet og verifiserte variantene
uten å overskrive det. CRUD-flyten er separat kjørt mot isolert 6f.

Den særskilte post-cutover recovery-drillen på a99 besto mot den da gjeldende
offentlige testdatabasen: ny custom-backup med kontrollert TOC og modus 0600,
isolert PostgreSQL 17-restore, schema 23 som no-op, byte-like 96/512-bildevarianter
via HTTP og database, bevarte eksisterende subject-lenker/audit, amcheck og
oppryddede restriktive kloner. Receipt-en er uttrykkelig bundet til `a99fbce`,
med uendret live-konfigurasjon. Den er historisk driftsbevis og må ikke
relables som bevis for en senere kilde.

Den endelige 6f post-cutover-drillen besto mot den offentlige testdatabasen med
ny custom-backup/TOC, isolert PostgreSQL 17-restore, migration 23 som no-op,
native og byte-like 96/512 WebP-varianter, bevarte subject-lenker/audit,
amcheck og ti serverte webressurser. Klonen hadde bare internt nettverk, ingen
porter, worker, live-vault eller modellkall og ble ryddet etterpå. Den native
ChatGPT runtime-wrapperens `--check` passerte på offentlig verts Bash/Docker/
Python 3 uten å lese credentials, importere eller kalle leverandør/modell.

Rollback følger [ADR 0022](../../decisions/0022-person-assets-calendar-and-task-subjects.md):
et eldre image kan bare tas i bruk etter verifisert lesekompatibilitet. Det er
ingen destruktiv nedmigrering, og gjenoppretting fra backup er et eksplisitt
valg som kan miste etterfølgende skrivinger. Dette er grunnen til at restore
drillen bruker isolerte kloner og ikke skriver tilbake over offentlig data.
For post-cutover data må en kompatibel kandidat og ny backup brukes; gammel kode
har ikke bevist skrivekompatibilitet mot nytt schema.

## Lokal AI-diagnose

Diagnosen er lesende. Tre historiske mislykkede dispatcher er bevart, og to
godkjente oppdrag er fortsatt aktive. Det finnes én registrert
upstream-/nettverksklassifisering og to invalid-response-klassifiseringer,
men beholdt metadata beviser ikke DNS-, TLS-, socket-, HTTP- eller konkret
parserårsak. Ingen manuell retry, modelloppdagelse, credential-import,
samtykke eller betalt fallback ble utført. Senere naturlige planlagte kjøringer
er bakgrunnsaktivitet og er ikke bevis på at lokal AI fungerer. QA utløste
ingen modellkall; én normal worker var sunn og godkjente tidsplaner ble bevart.

## Det eier må gjøre for ekte tilkoblinger

- Google: opprett en OAuth-webregistrering, lagre klientidentitet/-hemmelighet
  privat og samtykk med ønsket konto før kalender/kilder velges i Samvev.
- Microsoft: opprett delegert appregistrering med privat klienthemmelighet og
  riktig tenant, og samtykk deretter med egen konto.
- ICS: lim inn privat HTTPS-ICS-lenke i appen og velg personer/visning. Lenken
  skal ikke legges i Git, chat eller bilder.
- Spond: aktiver Sponds kalendersynk til den samme Google-/Outlook-kontoen,
  bekreft at kalenderen faktisk vises der, og velg den eksisterende kilden i
  Samvev. Bare kalenderhendelser omfattes.
- ChatGPT: kjør den lokale companion på egen maskin, gi eget samtykke og utfør
  privat overføring/import. Bekreft modellbruk separat etterpå. Ikke del
  cookies, passord eller tokens.
- Google/Gemini: avklar konkret abonnement og eventuell API-/billing-berettigelse
  før en separat implementasjonsbeslutning. Det er ikke en aktiv reservevei.

For offentlig runtime er den forberedte, ikke-mutative readiness-kontrollen:

```sh
cd /home/administrator/apper/samvev
bash scripts/chatgpt-import-runtime.sh --check \
  --household '<household-uuid>' \
  --owner-account '<owner-account-uuid>'
```

Den velger bare den bekreftede `samvev-m1`-appen og importerer ikke
credentials eller kontakter leverandør. Full flyt, importgrenser og sletting av
lokal overføringsfil er dokumentert i
[CHATGPT_PLAN_CONNECTION.md](../../CHATGPT_PLAN_CONNECTION.md). OAuth-redirecter,
minste rettigheter og kalenderoppsett er dokumentert i
[CALENDAR_CONNECTIONS.md](../../CALENDAR_CONNECTIONS.md):
`https://samvev.pabben.org/api/v1/calendar/oauth/google/callback` og
`https://samvev.pabben.org/api/v1/calendar/oauth/microsoft/callback` er de
offentlige redirect-adressene. Klienthemmeligheter blir bare lagt i eksisterende
privat runtime-konfigurasjon.

Se [leveransematrisen](round-9/delivery-matrix.json) for status per krav,
[runde-manifestet](round-9/manifest.json) for bilde- og kildeproveniens og
[sammenligningsmanifestet](round-9/comparison/manifest.json) for sporbar
referanse/runde-8/runde-9-sammenligning. Sammenligningen er avledet
reviewevidens, ikke en UI-capture eller designgodkjenning.

Alle implementerings-, QA-, sikkerhets-, UX- og driftsreceipter over er
fullført. Uavhengig release gate kjøres sist, etter at den DCO-signerte
review-commiten er opprettet og publisert til featurebranchen; denne rapporten
forhåndserklærer ikke dens resultat.
