# Runde 10 — kalenderkonvergens og korrekt oppdragsstatus

Mailbox: `48221157acd74aed2ab4ab218a81e870d2219f21`.
Source: `ca7359b0ce511f930aec3df0e11ce94ac4d203e6`.
Canonical runtime: `sha256:8fa9329df7a59773d1f294e030d045605cd14ad94ba6e8d557588a247f37a341`.
Round ID: `20261014094940-ca7359b0-428c5403`.
Review SHA er den senere DCO-commiten som inneholder denne rapporten; den endrer ikke UI-kilden.

## De fem rettelsene

| Funn | Levert retting og kontroll |
| --- | --- |
| Kalendermerking | Atomisk oppdatering av kildeavledet husstands-/person- og Spond-metadata; uendret providersnapshot konvergerer. UUID-er, fingerprint, tombstones, lesere og displaymål bevares. Faktisk seks-personers UI og streng SSE følger husstand → én person → to personer/Spond → husstand. |
| OAuth gjenopptak | Nytt kontobundet samtykke planlegger worker-synk for fortsatt aktiverte kilder. Ingen aktiverte kilder gir ingen publisering. Generation, kontobinding og gyldig initierende session sjekkes før og etter tokenutveksling; gamle callback-/workerforsøk og frakobling er fenced. |
| Tokenfeil | Avgrenset invalid_grant/400 ved tokenendepunkt gir utløpt tilgang/ny innlogging uten vanlig retry. Klientkonfigurasjonsfeil gir egen operatørstatus uten retry; 429, 5xx og nettverksfeil er midlertidige. Faktiske NB/EN-feilflater blokkerer Oppdater, forhåndsvisning og aktivering; pause beholdes. Ingen rå respons/token logges. |
| Personoppdrag | En logisk execution/run-visning inkluderer feil før run og avbrutt worker. Gjeldende revisjon og stabil rekkefølge avgjør status; tidligere gyldig resultat er tydelig eldre. Alle seks statuser vises faktisk, med nøyaktige siste/neste API-tider og lenke til eksisterende oppdrag. Ingen private oppdrag er kjørt, kopiert eller endret. |
| Paginering | Ett snapshot-tidsvindu gjennom alle sider; flyttende klokke og tom mellomside testes. Bare sidetoken endres. Sidefeil beholder tidligere hendelser; full snapshot gir ikke duplikater. |

## Kilde, bygg og tester

Full kanonisk Git-archive Docker runtime-build bestod. Det er et fullbygg, ikke overlay. Alle 231 input-hasher matcher arbeidsfiler, publishing-checkout og image; ti faktiske dist-asset-hasher er like i QA og kandidat. Runtime-image er 214 148 398 byte. Reviewbilder og npm-downloadcache er utelatt fra runtime.

Endelig isolert, seriell workspace-retest: **326/326**, null skips (web 67, kontrakt 5, core 3, API 251). Worker har ingen egne enhetstester; worker-livsløp dekkes av integrasjon. Alle workspace check/build og 16/16 host-pipelinekontroller bestod. 16 målrettede backendtester inkluderer samtidighet, migrasjonseksklusjoner og den ekstra session-revocation-feilen funnet i sikkerhetsreview.

Alle fem originale avvik fikk meningsfull baseline-RED før GREEN. Tidlige feil i OAuth-/pagineringstestfixturen regnes ikke som produktreproduksjon; korrigerte tester ble kjørt på eksakt baseline. Første samlede retest feilet fordi to testjobber utilsiktet delte samvev_test og kolliderte på TRUNCATE. Den feilen beholdes som feilet evidence; etter avsluttede jobber bestod én full seriell retest. Ingen tester ble svekket og ordinær QA/offentlig database ble ikke brukt som testdatabase.

## Visuell kontroll og bevaring

14 nye ordinary latest-bilder fra bash scripts/design-review.sh, med kildebundet runtime/build og eksplisitte personvernmasker. Disse viser den bevarte fem-personers LAN-husstanden med tom Today-flate; de er ikke seks-personers hovedbevis.

round-10/ har 14 faktiske isolerte seks-personersbilder og supplement/ ytterligere fire, fra to voksne og fire barn med fiktive data. Kalendergruppe/SSE, seks oppdragsstatuser, NB/EN, begge temaer, mobil og større skjerm, axe, overflow, dialogfokus, eksakte siste/neste tider, eksisterende oppdragslenke og display→member-avvisning består. Kalendertransporten er injisert syntetisk, ikke reell kontoverifikasjon. Fixture-begrensede kalender-rate-limit-vinduer ble aldret etter observerte 429 under iterasjon; produktgrenser og ordinary QA/offentlig data ble ikke endret.

UX åpnet alle 32 bilder individuelt: 14 ordinary, 14 målrettede og fire supplementbilder. Alle PNG-hasher, dimensjoner og manifestkilder ble kontrollert uavhengig. Ingen utestående visuell P0/P1 er bekreftet. Eksisterende mindre engelske entallstekst/scrollkant er dokumentert, ikke en bestilling om generell designomskriving. Dette er ikke eierens endelige designgodkjenning eller påstand om identisk referansedesign.

229 beskyttede hoved-.git-filer uendret; 566 historiske reviewfiler bevares byte-for-byte og forrige latest 15 filer ligger identisk i arkiv. Alle 14 ordinary QA-tabellers counts og full-JSON-hasher er eksakt bevart etter migrasjon/restart/capture. Faktisk admin/admin UI-login/logout og sourcebundne assets består på LAN.

## Migrasjon, drift og rollback

Additiv 024; 001–023 er uendret med eksakte checksums. Ukjent legacy OAuth completion-generation invalidert før backfill; pågående samtykke må startes på nytt. Default sentinel0 beholder gamle INSERT-former uten å autorisere et nytt generation-bundet forsøk. Reparasjon berører bare aktive occurrence-baserte metadata og klart autoriserte connected-kalendere med aktiverte kilder, NULL synktid og ingen lease. Pause/frakobling omgås ikke.

Kapasitet ble målt før tunge steg. Bare to beviselig ubrukte, unmounted, gjenoppbyggbare Samvev-kildetrær ble fjernet etter lokal backup av faktiske originalbytes/Unix-modes og kontroll av alle Git blobs. Ingen database, volum, backup, rollback-image eller aktivt kildetre ble fjernet. Målt før image-transfer: 890 159 104 tilgjengelig mot 832 945 062 nødvendig, inkludert to separate 300 MiB marginer og clone-reserve. Etter faktisk load var 403 857 408 byte ledig mot 384 964 861 for clone og gjenværende 300 MiB margin; alle 231 kildeinput ble kontrollert inne i det lastede imaget og kjørende containeridentiteter/helse var uendret. Ingen broad prune eller endring i andre prosjekter.

Offentlig test er faktisk publisert med source `ca7359b0ce511f930aec3df0e11ce94ac4d203e6` og image `8fa9329d…`. Én app, én normal worker og database er healthy. Hele HostConfig samt kommando, entrypoint, init, restart, nettverksaliaser, sikkerhet, capabilities, PID-grense, healthcheck, miljø og mounts matcher førbildet; database-ID, image, starttid og volum/mounts er uendret. Alle 24 ledgerchecksums er kontrollert direkte mot Git blobs.

Fersk pre-cutover schema23-backup ble faktisk gjenopprettet i isolert PG17, migrert til24 og kjørt gjennom migrasjonen igjen uten endring. Beskyttede invariants, amcheck, kandidatens og gammel6f-appens autentiserte lese-/bilde-/personoppdragsbaner samt kandidatens ti assets bestod. Etter worker→app-stopp ble eksakt quiescent23-dump og opaque invariants registrert med private SHA-er. Den samme dumpen ble gjenopprettet isolert og kontrollert gjennom24/noop/invariants/legacy-lesing. Separat fersk post-cutover24-backup ble gjenopprettet med samme kontroller. Ingen klone hadde worker, vault eller åpne porter, og alle midlertidige containere/nettverk/volumer ble fjernet; backuper og rollback-images er bevart.

En TypeError i main-agentens private etterkontroll-wrapper skjedde etter at første eksakte backuprestore hadde bestått. Den forberedte code/config-tilbakeføringen startet gammel6f-app og normal worker friskt på uendret schema24, uten DB-restore. Wrapperen ble rettet, ledger/data/idle verifisert, samme godkjente kandidatkonfigurasjon gjenopptatt uten migrasjonsrerun, og både eksakt backuprestore og fersk24-restore gjentatt med PASS. Feilen og de første receiptene er beholdt; de omtales ikke som applikasjonsfeil eller et uavbrutt utrullingsløp. Dette gir faktisk emergency-worker-helsekontroll, men gammel worker ble bevisst ikke startet i isolert restore.

Faktisk HTTPS UI-kontroll **17/17 PASS**: inn-/utlogging med eksisterende syntetisk konto; claimed/non-demo; alle sourcebundne assets; Secure/Strict/HttpOnly-cookie; egne beskyttede bildevarianter96/512 uten skriving; egen persondialog/fokus og oppdrag/readiness; CSRF, wrong-origin, cross-household, anonymous/display-grenser; SSE ready/heartbeat; Home, Integrasjoner og Oppdrag; preferanser og bilder bevart. En ytterligere guard blokkerer også household-scoped AI og models-GET samt alle API-skrivinger unntatt login/logout/preferanser; full17-kontroll ble gjentatt med PASS. Ingen sidefeil, eksterne browserforespørsler eller provider-/modellhandlinger i denne QA-flyten.

Alle ni utvalgte offentlige identitets-/domenetabellers full-JSON-hasher/counts er eksakte; de to private oppdragenes identitet/godkjenning/subjects/audits/tidsplan og mottakere er uendret. Auth-sesjoner og ordinære worker-runtimefelt inngår ikke i påstanden om byte-like domenetabeller. Code/config-rollback beholder schema24 og brukerdata; den gamle backupen skal ikke automatisk overskrive nye brukerskrivinger.

## Gjenværende eksterne brukerhandlinger

Reell Google/Microsoft-konto krever eierens samtykke; ICS/Spond-kilde må leveres/velges av eier. ChatGPT-samtykke/credential-import og lokal AI er fortsatt ikke live-verifisert. Ingen nye samtykker, imports, modellkall, manuell oppdragskjøring/retry eller betalt fallback ble utført for QA. Normal godkjent bakgrunnsaktivitet er observert som endringer i runtimefelt under arbeidet. De to private oppdragenes identitet, subjectmetadata/audits, mottakere, godkjenning og godkjente tidsplaninnstillinger var uendret på lesende kontroll. Dette er separat fra QA: runden har ikke manuelt dispatcheret, tolket, kopiert, reaktivert eller endret disse oppdragene. Ingen private runtimeverdier eller resultater publiseres.

Ingen PR, merge, main-/force-push, tag, release eller Actions-dispatch er startet. Den allerede autoriserte offentlige testpubliseringen er utført etter reelle driftsgater. Endelig Git-leveranse består av sourcecommiten over og den DCO-signerte reviewcommiten som inneholder denne rapporten, med normal push kun til featurebranchen.

## Endrede filer

Kildecommiten endrer disse 16 filene:

- `.dockerignore`
- `Dockerfile`
- `apps/web/src/calendar-connections.tsx`
- `apps/web/src/calendar-presentation.ts`
- `apps/web/src/locales/en.ts`
- `apps/web/src/locales/nb.ts`
- `apps/web/src/person-task-presentation.ts`
- `apps/web/src/person-tasks.tsx`
- `apps/web/tests/round10-presentation.test.ts`
- `scripts/design-review-provenance.mjs`
- `scripts/design-review-provenance.test.mjs`
- `services/api/migrations/024_round10_calendar_and_monitor_repairs.sql`
- `services/api/src/api.integration.test.ts`
- `services/api/src/calendar/service.ts`
- `services/api/src/monitor/subjects.ts`
- `services/api/src/round10-backend.integration.test.ts`

Reviewcommiten legger til rapport/status, kilde-/test-/driftsreceipter, 14 nye latest-bilder, det byte-bevarte arkivet og round-10/ med 18 målrettede bilder. Private credentials, dumpfiler, SSH-materiale og operative helpers ligger kun i ignorert .local/ og pushes ikke.

## Direkte test- og reviewlenker

- [Offentlig test](https://samvev.pabben.org/), [Personer](https://samvev.pabben.org/?tab=people), [Kalendere](https://samvev.pabben.org/?tab=integrations), [Oppdrag](https://samvev.pabben.org/?tab=monitors). Bruk eksisterende autorisert innlogging; admin/admin er kun LAN-demoen.
- [LAN-demo](http://192.168.0.220:4173), faktisk admin/admin-login/logout verifisert på slutten av runden.
- [Latest manifest](latest/manifest.json), [seks-personers kjerne](round-10/manifest.json), [supplement](round-10/supplement/manifest.json).
- [Bygg](round-10/checks/canonical-image-proof.json), [tester/UI](round-10/checks/tests-and-ui.json), [recovery](round-10/checks/public-recovery.json), [offentlig runtime](round-10/checks/public-runtime.json), [HTTPS](round-10/checks/public-https.json), [bevaring](round-10/checks/final-preservation-check.json), [private oppdragsinvarianter](round-10/checks/private-task-preservation.json).

Normal review-kommando er `bash scripts/design-review.sh`, etter nødvendig kildecheckpoint og `bash scripts/design-review-runtime.sh` + `bash scripts/design-review-build.sh`. Denne runden brukte alle tre. NEXT_CODEX_PROMPT.md er fortsatt passiv og utføres bare etter brukerens eksplisitte bestilling.
