# Runde 15 – krav og kontrollmatrise

## Gjeldende status – 2026-10-29

Delvis R15 er offentlig publisert på source `05cf86dc83ab70070b7050b2c25fa71cff6380bb`, image `sha256:20a587bbc1f8630afdbb02be881ef97f996ae8ee58eaa14c1c7112afdaf61e10`, database schema 45. Backup/restore gates, service health and public HTTPS smoke 11/11 PASS. Final QA evidence is: isolated API 437/437, zero failures; web 207/207, contracts 7/7, core 3/3 and typecheck PASS. Overlapping stale test runners invalidated the initial API full-run attempts; the final API run passed in the isolated test service/test-db after stopping stale runners. Web/contracts/core results are from preceding completed stages of the final suite.

Public smoke reached the People route, but did not test color editing: `peopleColorControl=not-authorized` because the synthetic account lacked `people.manage`. School task A only has an observed final JSON/schema validation failure; raw output is unavailable, so its cause is not established. Task B remains undiagnosed. The #19 logo assets were removed from delivery; actual logos remain unshipped pending rights evidence. Generic code-native glyphs and visible names are used.

Canonical `latest/` contains 14 masked empty-day Home captures for the six-person fixture, Round ID `20261029134403-05cf86dc-28ee8faa`, source SHA `05cf86dc83ab70070b7050b2c25fa71cff6380bb`. `bash scripts/design-review.sh` passed. These images are layout/theme evidence only, not rich functional or physical-device proof; separate source-05cf functional and visual evidence is held in ignored local evidence outputs. Owner-controlled consent, endpoint, private ICS, school display, logo-rights and physical-device checks remain open. The matrix and checkpoints below preserve historical context and are superseded wherever they conflict with this current status.

Historisk status på tidspunktet for baseline: arbeid pågikk 28. oktober 2026. Brukerbestillingen fra den datoen var gjeldende; mailboxens historiske R12-punkter skulle ikke implementeres på nytt.

Historisk utgangspunkt 28. oktober (superseded): publishing-checkout `feat/m3-family-hub` på `a731dbc3a011a398d70f340f5f9fb475e7a9a487`; offentlig source `971913e321dd82f491214fdbda81d08f8123a891`, image `sha256:4aef88306949a5b591e4af94ce0e769d3dffe73526dad663fa90ab8e44160342`. App/worker/database friske. 325 app-/byggfiler i hovedarbeidsområdet matcher publisher. Hoved-.git er beskyttet/stale og brukes ikke som kildebevis.

### Historisk kravbaseline (28. oktober; status erstattet av sluttkontrollen nedenfor)

Tabellen under registrerer opprinnelig baseline, ikke gjeldende akseptstatus. Se [sluttkontroll](#sluttkontroll-2026-10-29-130749-utc) og [offentlig aksept](#offentlig-aksept-2026-10-29-133505-utc) for endelig scope, QA og deployment. Skoleoppfølgingen er fortsatt åpen som oppgitt der.

| ID | Krav / avgrensning | Kontroll | Status |
|---|---|---|---|
| S1 | Diagnostiser de to eksisterende skoleoppdragenes feil fra lagret kilde-/kjøringsbevis; rett bekreftede programvarefeil. Skill feil, utdatert, vellykket uten funn og praktisk informasjon. Ingen kopier, nye modellkall eller endret tidsplan/godkjenning. | Privat lesende diagnose; syntetiske reproduksjoner av årsak; kildeforankring/datoer/proveniens; konfigurasjon bevart. | Pågår |
| T1 | Personkort: bare relevante aktiviteter i dag/i morgen som ikke er avsluttet. Timed slutt eksklusiv; uten sluttid behandles tidspunkt som et punkt, ikke uendelig pågående. Heldag varer gjennom angitte sivile dager, eksklusiv sluttdato, ellers én dag. | Husstandstidssone, DST, over midnatt, manglende slutt, live klokke uten reload, medlem/skjerm. | Åpen |
| T2 | Dag/uke/persondetaljer bevarer forståelig historikk. Neste viser ett pågående/kommende gyldig element etter samme regel. Skole utløper ved kjent slutt eller 13 lokal tid; eksplisitt senere aktivitet bevares. | API/UI-klokketester, gammel kilde må ikke gjenopplive utløpt resultat. | Åpen |
| D1 | Kompakt forside nær faktisk referanse, konsistent tetthet begge temaer, mindre tomrom under dagskort, tom familiebordseksjon skjult/komprimert. Privat bakgrunn bevares. | Sammenlignbare syntetiske før/etterbilder; tom/normal/rik; seks personer; mobil/nettbrett/desktop/Shelly. | Åpen |
| D2 | Bevar bursdager/profilbilder/diskret feiring/reduced motion, relevant avfall i dag/morgen, beskjedavsender/håndskrift, personfilter/kalenderdetaljer og ingen footer. | Målrettet regresjon; lys/mørk/system og fokus/kontrast. | R14 levert, ny regresjon nødvendig |
| V1 | Skjermoppsett per skjerm: innhold, utseende/forhåndsvisning, tilgang, åpning/paring. Personvalg må ikke forveksles med profilbilde-/bursdagstillatelser. Konkrete kildetyper. | Ekte GUI med syntetiske skjermer; behold adresser/paring/revokering; server-ACL og skjermavsender/mottakere uten ekte meldinger. | Åpen |
| I1 | ICS-førstesteg: synlig Google-/Outlook-hjelp fra offisielle kilder, abonnementslenke vs fil/HTML, sikker behandling, separate delinger, frakobling vs sletting. Eksisterende motor. | Locale/UI/lifecycle/feil/tom/preview/synk; ingen ekte privat kilde aktiveres. | Åpen |
| O1 | Skill faktisk HA-synk, Google-samtykke, Microsoft-appregistrering og skolefeil/visningsaktivering. | Lesende status, ingen tokens/navn/privat innhold i rapport/Git. | Pågår |
| R1 | Isolerte lokale tester/bygg, sikkerhets-/krav-/UX-review, samlet relevant QA, release gate, backup/restore ved migrasjon, offentlig testpublisering og HTTPS-kontroll. | Source/runtime/dist/bildebinding; DCO featurepush; ingen PR/main/force/tag/release/dispatch. | Delvis PASS: isolert QA, reviews, backup-/restore-gates, delvis offentlig publisering og HTTPS-smoke 11/11 bestod. Gjeldende omfang er betinget av #19-rettigheter, skoleoppfølging og eierstyrte integrasjoner/fysisk kontroll. |

## Issues kontrollert

Lesende kontroll 2026-10-28 ca. 18:01 UTC, siste døgn fra 2026-10-27 18:01 UTC. Fem åpne issues, ingen kommentarer. #15 oppdatert 2026-10-27T23:12:17Z, #14 23:01:32Z og #13 23:00:39Z: grunnfunksjonene er levert i R14 og bevares; denne runden retter konkrete oppfølgingsfeil/hjelp. #3 (2026-09-09T15:06:19Z) om temavalgkontrast inngår som regresjon. #12 (2026-09-21T07:33:20Z) om fysisk Shelly/iPad-validering er separat og ikke releaseblokkering. Ingen issue lukkes eller kommenteres.

## Beslutninger og eieravhengigheter

- Kalenderinnhold/personkobling og leser-/skjermrettighet er fortsatt uavhengige. Ingen automatisk utvidelse av deling eller sammenslåing av like skjermnavn.
- Manglende sluttid gir ikke oppdiktet varighet. Historikk bevares selv om et tidspunkt ikke lenger er aktuelt på personkortet.
- Skolefeil skal diagnostiseres separat fra aktivering av visningsmetadata. Ingen generell eierblokkering for feilretting.
- Ekte provider-/modell-/fysiske HA-kall inngår ikke i automatiske tester. Eksisterende planlagte kjøringer kan naturlig endre historikk; kontrollen skal bevise at oppdragskonfigurasjon/godkjenning/tidsplan er bevart.
- Offentlig testpublisering er allerede autorisert. Personlig OAuth-samtykke og eventuell visningsaktivering krever riktig eierøkt, men blokkerer ikke uavhengige rettinger.

## Utvidelse: issues 16–19, samme leveranse

Gjeldende beskrivelser og kommentarer ble lest 28. oktober 2026. Alle fire har ingen kommentarer ved denne kontrollen. #16 ble opprettet 20:50:56 UTC, #17 21:15:22, #18 21:16:00 og #19 21:16:26. Tidligere arbeid og testbevis beholdes. En siste avgrenset issuekontroll utføres én gang før sluttkontroll; kontrolltidspunktet avslutter omfanget. Ingen issues kommenteres eller lukkes.

**Kravprioritet:** #16 erstatter #14s maskering bare i autorisert administrasjon. Kalenderlenker forblir kryptert og utelatt fra deltakere, skjermer, logger og publiserte testbilder.

| Issue / kriterier | Ansvar | Kontroll | Status |
|---|---|---|---|
| #16 webcal→HTTPS med samme SSRF-/redirectvern; mål faktisk FotMob og større/historiske/eldre gjentakelser; avgrenset CPU/minne/bytes; distinkte feil, siste gyldige innhold beholdes | A: school15_finish, Luna high; hovedagent integrerer | Offentlig feed med begge skjema, målte metadata uten innhold; syntetisk grense-/RRULE-/feiltest | Implementert og publisert i partial R15. Lokal parser-/kildekontroll 36 tester +33 monitoragenttester; begge FotMob-skjema ga 26 hendelser. Offentlig smoke verifiserte ICS-grensesnittet. Privat kalenderårsak, eierens private ICS-kilde og faktisk heap-/parserfristgrense er ikke verifisert. |
| #16 «Kalenderlenke (ICS)» vanlig felt, autorisert les/kopier/åpne/rediger etter lagring; eksplisitt serverautorisasjon/no-store/kryptering og generasjonsvern | A | Eier/manager og nektet deltaker/display; URL-endring under pågående sync; ingen hemmelig URL i rapport/logg/skjermbilder | Implementert/publisert partial R15. 6 API-tester, 9 feilpresentasjonstester og Chromium-maskeringstest PASS; funksjonell nettleserkontroll av kilde 05cf og offentlig ICS-grensesnittsmoke PASS. Ingen privat ICS-URL er brukt som akseptbevis; eierkontroll av den private kilden gjenstår. |
| #17 gjenkoble eksisterende ID via femminutters engangskode; behold alle innstillinger/delinger, roter credential, steng gammel tilgang/SSE; selvbytte uten cookieverktøy | B: school15, Sol high for autentiseringsgrenser; C: ui15, Luna high | To isolerte nettlesere, konkurrerende redeem, utløpt kode, feil verifier, kryss-husstand, revokering, lesing over rotasjon, gamle callbacks/cache | Backend/UI og sterkere klientretting implementert/publisert partial R15. Endelig isolert API 437/437, web 207/207 og funksjonell nettleseraksept for kilde 05cf 14/14 PASS. Offentlig smoke bestod, men People-ruten dokumenterer ikke skjermparing; flerenhets-/fysisk skjermkontroll gjenstår hos eier. |
| #17 identitet/oppsett og serveravledede tilstander for nettverk/personvern/ingen valg/ingen deling/tom gyldig kalender; direktetilkobling er transportstatus | B + C | Autoriserte projeksjoner uten skjulte kildenavn; reelle syntetiske UI-tilstander | Server-DTO, kildespesifikk klarstatus og UI implementert/publisert uten private kildenavn. Lokal funksjonell evidens for kilde 05cf og offentlig HTTPS-smoke PASS; enhetstesting/paring på faktiske skjermer er ikke kontrollert. |
| #18 sammenleggbar språk/utseende med effektivt sammendrag og arvevalg i menyer | C | Lagring/null-arv/overstyring, mobil, tastatur | UI implementert/publisert; endelig web-suite 207/207 og typekontroll PASS. Offentlig navigasjonssmoke på desktop/mobil bestod. Detaljert tastatur-/enhetsspesifikk kontroll gjenstår. |
| #18 birthday_mode off/all/legacy_selected: all er alle nåværende/fremtidige husstandsbursdager uavhengig av personfilter; off ingen; migrering bevarer gamle begrensninger | B + C | Blandede gamle grants uendret, ny person, ikke valgt person, privacy/revokering, selvstendige dagkort/preview; ingen foto-/kalendergrant fra bursdag | Backend og UI implementert/publisert med policy-/webtester; endelig isolert QA og restore-gates PASS. Funksjonell nettleserevidens for kilde 05cf PASS. Offentlig smoke beviser ikke alle bursdagstilstander eller fysisk skjermatferd. |
| #18 personvalg per enhet via nullable override (NULL arv, [] ingen), velg/fjern alle og enkeltvalg på kort og oppsett; ingen automatisk kildedeling | B + C | Arv, current-ID-valg, effektive filtre/ACL, delt oppsett ikke endret ved enhetsvalg | Backend og UI implementert/publisert med isolerte policy-/webtester. Arv, all/off/legacy og uavhengige bursdagsrader kontrollert; endelig QA og restore-gates PASS. Fysiske skjermer er ikke kontrollert. |
| #19 faktiske lokale originalressurser Google Calendar/Outlook/Spond/Home Assistant og generisk ICS, kilde/bruksgrunnlag, navn og skjermleser/fokus | D: home15, Luna high | Rettighetsgrunnlag, ingen eksterne bildekall, lys/mørk/mobil og dekorativ alt/aria | Ikke levert: lokale logoressurser er fjernet etter rettighetsgjennomgang; dokumentert bruksrett mangler. Faktiske logoer er ikke publisert. UI bruker generiske kodebaserte symboler med synlige navn. Tidligere 31 tester/komponentkontroll gjaldt fjernede ressurser. |
| #3 åpen temameny på Chrome/Windows; #12 fysisk Shelly/iPad | QA | Åpen meny kontrolleres lokalt; Linux Chromium oppgis hvis Windows ikke finnes. Fysisk kontroll separat | Eiertest på fysiske enheter er ikke releaseblokkering. |

### Bevarte resultater

Tidligere integrert kandidat `2445c34` bestod 546 tester (167 web, 5 contracts, 3 core, 371 API), ingen skips. Siste kopiretting `cc4d01f` endrer bare to locale-filer; 167 webtester og web-typekontroll bestod på den. Dette er bevis for foregående krav, ikke forhåndsgodkjenning av nye 16–19-endringer. På tidspunktet for denne tidligere kontrollen var offentlig versjon R14. Alle nye produktendringer får nye kilde-/runtime-/capturebevis.

### Gjenopprettingsgrense etter nye skjermpolicyer

R14-appfallback er ikke tillatt etter at ny personoverride/bursdagspolicy er tatt i bruk: gammel kode kan ignorere begrensningene. Backendfeil krever fremoverrettet retting med data beholdt. UI-fallback kan bare bruke et særskilt verifisert API-kompatibelt R15-kildepunkt som håndhever begge policyene. Den opprinnelige restore-planen omfattet migrasjonene 041→044. Gjennomført R15 cutover/restore-verifikasjon dekker gjeldende schema 45: fersk quiescent backup, pre-/post-cutover isolerte restore-gates PASS for source `05cf86dc83ab70070b7050b2c25fa71cff6380bb`, og data/vault/config-hasher bevart. Se gjeldende status ovenfor. Ingen gammel database legges over nye brukerendringer.


## Sluttkontroll – 2026-10-29 13:07:49 UTC

Denne kontrollen erstatter eldre statusfelt ovenfor der de er i konflikt. Issue-recheck fant ni åpne saker og ingen nye kommentarer. Ingen saker ble endret.

| Krav | Oppdatert status og avgrensning |
|---|---|
| #16–18 | Implementert i kandidat `05cf86dc83ab70070b7050b2c25fa71cff6380bb`. Final QA PASS: isolert API 437/437 (0 feil), web 207/207, contracts 7/7, core 3/3, web-typekontroll PASS og source-05cf funksjonell nettleserkontroll 14/14. |
| #19 | Betinget/ikke levert: faktiske leverandørlogoer er ikke med fordi bruksrettigheter ikke er dokumentert. UI viser kodebaserte generiske symboler med synlige leverandørnavn. Eier må levere rettighetsgrunnlag før lokale logoressurser kan tas inn. |
| Skoleoppdrag A | Kun en feil i endelig JSON/schema-validering ble observert. Råmodellresultatet ble ikke lagret, så konkret årsak er ukjent og ikke tilskrevet kildefeil eller syntetisk test. Ingen reparert livekjøring hevdes. |
| Skoleoppdrag B | Eldre generell feil er ikke diagnostisert til rotårsak. Ingen reparert livekjøring hevdes. |
| Restore/cutover | PASS: clone gate, fersk quiescent backup, pre-/post-cutover isolerte restore-gates; publisert 2026-10-29 13:35:05 UTC. Source `05cf86dc83ab70070b7050b2c25fa71cff6380bb`, image `sha256:20a587bbc1f8630afdbb02be881ef97f996ae8ee58eaa14c1c7112afdaf61e10`, schema 41→45. HTTPS smoke 11/11; app/worker/db healthy; data/vault/config hashes bevart. #19 og eierintegrasjoner gjenstår. |

Final canonical capture is the synthetic six-person Round ID `20261029134403-05cf86dc-28ee8faa`; `bash scripts/design-review.sh` passed and all 14 PNG hashes/source SHA `05cf86dc83ab70070b7050b2c25fa71cff6380bb` match. Bare de 14 personvernmaskerte PNG-ene og hashmanifestet er publisert i `latest/`; ingen private nettleserbilder eller runtime-identiteter er med. UX- og sikkerhetsreview er PASS. Kravreview er betinget GO, med #19 og eieravhengighetene åpne. Endelig QA er PASS (API 437/437, web 207/207, contracts 7/7, core 3/3, typekontroll og nettleser 14/14). Delvis R15 er publisert etter bestått backup/restore og HTTPS-smoke; dette lukker ikke #19 eller eierhandlingene.

Skoleoppdrag A: kun endelig JSON/schema-valideringsfeil observert; råutdata mangler og årsaken er uverifisert. B er fortsatt udiagnostisert. Ingen modellkall, oppdragsendringer eller live-reparasjon ble gjort.

En QA-hendelse oppstod da en full test ved en feil traff QA-appen og forkortet syntetisk QA-database. Hovedagenten gjenopprettet framover fra 00:08-backup inn i gjeldende schema 45 etter isolert donor-/testrestore. 86 tabellhashverdier og FK-er, AI-rater/ledger, innlogging/`me` 200 og app/worker-helse ble kontrollert. QA-endringer etter backup kan mangle; offentlige data ble ikke berørt.


### Offentlig aksept – 2026-10-29 13:35:05 UTC

Partial R15 source/deploy `05cf86dc83ab70070b7050b2c25fa71cff6380bb`, image `sha256:20a587bbc1f8630afdbb02be881ef97f996ae8ee58eaa14c1c7112afdaf61e10`, schema 41→45. Fresh quiescent backup and pre/post isolated restore gates passed. Public HTTPS Playwright smoke 11/11 passed; health and `/om`, `/personvern`, `/vilkar`, `/display` returned 200. Data, vault, and configuration hashes remained preserved. The publication is explicitly partial: actual #19 logos await rights evidence and owner-controlled integrations/physical-device checks remain outstanding.
