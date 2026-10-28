# Runde 15 – krav og kontrollmatrise

Status: pågående. Brukerbestillingen 28. oktober 2026 er gjeldende; mailboxens historiske R12-punkter skal ikke implementeres på nytt.

Bekreftet utgangspunkt: publishing-checkout `feat/m3-family-hub` på `a731dbc3a011a398d70f340f5f9fb475e7a9a487`; offentlig source `971913e321dd82f491214fdbda81d08f8123a891`, image `sha256:4aef88306949a5b591e4af94ce0e769d3dffe73526dad663fa90ab8e44160342`. App/worker/database friske. 325 app-/byggfiler i hovedarbeidsområdet matcher publisher. Hoved-.git er beskyttet/stale og brukes ikke som kildebevis.

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
| R1 | Isolerte lokale tester/bygg, sikkerhets-/krav-/UX-review, samlet relevant QA, release gate, backup/restore ved migrasjon, offentlig testpublisering og HTTPS-kontroll. | Source/runtime/dist/bildebinding; DCO featurepush; ingen PR/main/force/tag/release/dispatch. | Åpen |

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
| #16 webcal→HTTPS med samme SSRF-/redirectvern; mål faktisk FotMob og større/historiske/eldre gjentakelser; avgrenset CPU/minne/bytes; distinkte feil, siste gyldige innhold beholdes | A: school15_finish, Luna high; hovedagent integrerer | Offentlig feed med begge skjema, målte metadata uten innhold; syntetisk grense-/RRULE-/feiltest | Lokalt implementert og målrettet testet: 36 parser/kilde +33 monitoragenttester. Begge FotMob-skjema gir 26 hendelser. Privat kalenderårsak fortsatt ubekreftet. Visuell/sluttkontroll og offentlig publisering gjenstår. |
| #16 «Kalenderlenke (ICS)» vanlig felt, autorisert les/kopier/åpne/rediger etter lagring; eksplisitt serverautorisasjon/no-store/kryptering og generasjonsvern | A | Eier/manager og nektet deltaker/display; URL-endring under pågående sync; ingen hemmelig URL i rapport/logg/skjermbilder | Implementert. 6 API-tester dekker administrator, vanlig eier, gyldig skjerm, tilbakekalt økt og revisjoner; 9 feilpresentasjonstester og Chromium-maskeringstest består. Nettleserflyt/sluttkontroll gjenstår. |
| #17 gjenkoble eksisterende ID via femminutters engangskode; behold alle innstillinger/delinger, roter credential, steng gammel tilgang/SSE; selvbytte uten cookieverktøy | B: school15, Sol high for autentiseringsgrenser; C: ui15, Luna high | To isolerte nettlesere, konkurrerende redeem, utløpt kode, feil verifier, kryss-husstand, revokering, lesing over rotasjon, gamle callbacks/cache | API-/datakontrakt avklart. Ingen reelle skjermer kobles om som test. |
| #17 identitet/oppsett og serveravledede tilstander for nettverk/personvern/ingen valg/ingen deling/tom gyldig kalender; direktetilkobling er transportstatus | B + C | Autoriserte projeksjoner uten skjulte kildenavn; reelle syntetiske UI-tilstander | Nytt krav |
| #18 sammenleggbar språk/utseende med effektivt sammendrag og arvevalg i menyer | C | Lagring/null-arv/overstyring, mobil, tastatur | Eksisterende grupper gjenbrukes og tilpasses |
| #18 birthday_mode off/all/legacy_selected: all er alle nåværende/fremtidige husstandsbursdager uavhengig av personfilter; off ingen; migrering bevarer gamle begrensninger | B + C | Blandede gamle grants uendret, ny person, ikke valgt person, privacy/revokering, selvstendige dagkort/preview; ingen foto-/kalendergrant fra bursdag | Nytt server-/datamodellkrav |
| #18 personvalg per enhet via nullable override (NULL arv, [] ingen), velg/fjern alle og enkeltvalg på kort og oppsett; ingen automatisk kildedeling | B + C | Arv, current-ID-valg, effektive filtre/ACL, delt oppsett ikke endret ved enhetsvalg | Nytt krav |
| #19 faktiske lokale originalressurser Google Calendar/Outlook/Spond/Home Assistant og generisk ICS, kilde/bruksgrunnlag, navn og skjermleser/fokus | D: home15, Luna high | Ressursproveniens, ingen eksterne bildekall, lys/mørk/mobil og dekorativ alt/aria | Offisielle kilder undersøkt. Eksakte ressurs-/bruksvilkår må avklares uten å dikte lisenser. |
| #3 åpen temameny på Chrome/Windows; #12 fysisk Shelly/iPad | QA | Åpen meny kontrolleres lokalt; Linux Chromium oppgis hvis Windows ikke finnes. Fysisk kontroll separat | Eiertest på fysiske enheter er ikke releaseblokkering. |

### Bevarte resultater

Tidligere integrert kandidat `2445c34` bestod 546 tester (167 web, 5 contracts, 3 core, 371 API), ingen skips. Siste kopiretting `cc4d01f` endrer bare to locale-filer; 167 webtester og web-typekontroll bestod på den. Dette er bevis for foregående krav, ikke forhåndsgodkjenning av nye 16–19-endringer. Offentlig versjon er fortsatt R14. Alle nye produktendringer får nye kilde-/runtime-/capturebevis.

### Gjenopprettingsgrense etter nye skjermpolicyer

R14-appfallback er ikke tillatt etter at ny personoverride/bursdagspolicy er tatt i bruk: gammel kode kan ignorere begrensningene. Backendfeil krever fremoverrettet retting med data beholdt. UI-fallback kan bare bruke et særskilt verifisert API-kompatibelt R15-kildepunkt som håndhever begge policyene. Backup/isolert restore skal dekke 041→042 og nye additive 043/044 med eksakte invariants. Ingen gammel database legges over nye brukerendringer.
