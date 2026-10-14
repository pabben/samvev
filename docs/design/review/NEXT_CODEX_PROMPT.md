# Samvev – runde 10: målrettet retting etter runde 9

Fortsett i samme server-Codex-økt under et aktivt `/goal`. Work har gjennomgått runde 9 og endrer bare denne mailboxen; server-Codex implementerer, tester og publiserer. Dette erstatter den fullførte runde-9-bestillingen med fem konkrete funksjonsrettinger og nødvendig bygg-/driftskontroll. Ikke start en generell design- eller funksjonsrunde.

## Mål, baseline og autonomi

- Repo/branch: `pabben/samvev`, `feat/m3-family-hub`.
- Runde 9 source/deploy: `6f9f5c50478b680c0c435d782f2a5d99e8a1ed9e`.
- Runde 9 review: `8156731376fb6205b909aaee4824bac18ff7941d`.
- Round ID: `20261014052355-6f9f5c50-3f5e1278`.
- Offentlig test: https://samvev.pabben.org/.

Les AGENTS, review-README, ROUND_9_REPORT, leveransematrisen, manifests, ADR 0022 og gjeldende drifts-/recovery-bevis. Integrer eventuelt nyere branch-arbeid uten reset eller overskriving. Bruk publishing-checkouten og bevar beskyttet hoved-.git. Følg prosjektets fagreview med parallelle lesende agenter, én skriver om gangen, etterreview, qa_engineer og release_gate sist.

Jobb autonomt gjennom reproduksjon, retting, tester, kildebundet runtime/capture, review og allerede autorisert offentlig testpublisering. Velg rutinemessige detaljer selv. Manglende ekstern konto, OAuth-samtykke eller diskutvidelse skal bare blokkere avhengig live-kontroll/deploy; fullfør alt øvrig arbeid. Bevar et konkret gjenopptakingsnotat ved budsjett-/kontekstgrense. Stopp kontrollsløyfen når målet er dokumentert nådd.

Work har kontrollert alle 125 unike PNG-hasher, 227 kildeinput-hasher og et representativt visuelt utvalg, samt relevant kode og publiserte receipter. Ikke påstå at Work åpnet alle bilder eller gjentok serverens tester. Runde 9s 63 HTTPS-kontroller og recovery er serverens bevis. De 305 testene gjaldt en tidligere kandidat med samme applikasjonskode; finalkilden hadde separate wrapper-/capture-/driftskontroller. Full kanonisk finalbygg feilet på diskplass; den dokumenterte overlay-leveransen skal ikke omtales som et bestått fullbygg.

Profilbilder, personkoblinger, kalenderadaptere, Spond-bro og ChatGPT-guide er levert. Ingen ny visuell P0/P1-regresjon er bekreftet i utvalget; dette er ikke endelig eiergodkjenning av referanselikhet. Reelle kalenderkontoer/Spond og ChatGPT-samtykke/import er fortsatt ikke live-verifisert. Lokal AI er heller ikke dokumentert fungerende. De fem P2-funnene nedenfor gjelder kodebaner som tidligere kontroller ikke dekket, ikke en påstand om at alle pågår i den private installasjonen.

## 1. Kalenderens person-/husstandsmerking må følge kildeendringen

I baseline oppdaterer `services/api/src/calendar/service.ts:updateSource` kilde, personer og mål, men ikke eksisterende elementers `metadata.calendar.subjectHousehold` eller `bridgeKind`. `reconcileSource` erstatter metadata bare når hendelsens fingerprint endres. `home-presentation.ts:itemHousehold` prioriterer dette metadatafeltet; persondetaljer i `family-hub.tsx` bruker det til gruppering. En kalender endret fra husstanden til én person kan dermed fortsette som fellesinnhold etter uendret synk.

Rett kildeavledet metadata atomisk ved endring, og sørg for trygg konvergens for allerede lagrede feilmerkede elementer. Bevar hendelses-ID-er, historikk, revisjonsvern og tombstones. Ikke slett/reimporter kalenderen eller bruk hendelsestittel som identitet. Subject og lesere er fortsatt forskjellige begreper; dette funnet er ikke dokumentasjon på en tilgangslekkasje.

Test begge retninger mellom husstand og person, flere personer og endret Spond-bromerking. Kontroller lagrede data, ny lasting/SSE og uendret neste providersnapshot. Vis at korrekt person-/fellesgruppe nå brukes, uten endrede leser-/displayrettigheter eller duplikater.

## 2. Automatisk synk må gjenopptas etter ny OAuth-innlogging

Ved `calendar_reauthorization_required` setter `syncConnection` tilstanden til utløpt og `next_sync_at=NULL`. `completeOAuth` lagrer nye tokens og «connected», men setter ingen ny synktid. Workerens `runCalendarSyncBatch` velger bare forfalte ikke-null tider, og UI laster bare status på nytt. Tidligere aktive kalendere kan derfor bli stående «tilkoblet» uten automatisk oppdatering.

Et vellykket, kontobundet OAuth-forløp skal planlegge synk for fortsatt godkjente, aktiverte kilder uten at brukeren må trykke Oppdater. Bevar generation-/lease-/scope-vern. Førstegangstilkobling uten aktiverte kilder skal ikke publisere kalenderinnhold. Deaktiverte kilder og frakoblede tilkoblinger skal ikke reaktiveres av en generell reparasjon.

Test hele livsløpet isolert: utløpt → nytt samtykkesvar → worker velger jobben → vellykket synk uten manuell handling. Test også ingen aktive kilder, frakobling og et gammelt callback-/workerforsøk. Vurder avgrenset reparasjon av eksisterende «connected + aktive kilder + NULL»-tilstand uten å omgå uttrykkelig pause/frakobling.

## 3. Klassifiser tilbakekalte refresh-tokens korrekt

`calendar/service.ts:jsonRequest` klassifiserer etter HTTP-status og behandler bare 401 som ny innlogging nødvendig. OAuth `invalid_grant` med HTTP 400 blir generisk providerfeil, og kalenderen forsøkes igjen hvert 15. minutt. Google dokumenterer 400 for ugyldig, utløpt eller tilbakekalt grant/refresh-token.

Bruk dokumenterte, avgrensede feilkoder i tokenresponsen til å skille utløpt/tilbakekalt brukertilgang fra midlertidig providerfeil og operatørens klientkonfigurasjonsfeil. Ikke klassifiser alle 400-svar som utløpt konto, og ikke logg rå respons, tokens eller klienthemmeligheter. Gjeldende Google-/Microsoft-adaptere skal ha konsistent, forståelig status og riktig neste handling.

Test `invalid_grant`/400, relevant klientkonfigurasjonsfeil, 429, 5xx og nettverksfeil med isolert transport. Utløpt tilgang skal gi ny-innlogging-handling og stoppe vanlig retry til tilgangen er gjenopprettet. Verifiser deretter gjenopptak fra punkt 2. Endre ikke ChatGPT-refresh som en utilsiktet del av denne kalenderrettingen.

Primærkilde: https://developers.google.com/identity/openid-connect/reference — token-endepunktets feiloversikt.

## 4. Personkort må vise også tidlige og avbrutte oppdragsfeil

`services/api/src/monitor/subjects.ts:personMonitorSummaries` henter siste ferdige forsøk bare fra `monitor_runs`; executions brukes bare til å finne queued/running. `monitor/execution.ts` kan lagre en terminal failed execution før en run er opprettet, blant annet ved forberedelsesfeil og `MONITOR_WORKER_INTERRUPTED`. Personkortet kan da vise «Ikke kjørt» eller gammel suksess uten den nye feilen.

La siste relevante execution/run gi korrekt status og tidspunkt, med én logisk kjøring når begge rader finnes. Definer stabil tidsrekkefølge og håndtering av gjeldende oppdragsrevisjon, erstattede forsøk og queued/running. Bevar et eldre gyldig resultat som tydelig eldre; ikke erstatt det med et oppdiktet forslag eller rå intern feil. Lag ikke kunstige runs bare for å fylle visningen.

Test API og faktisk personvisning for: aldri kjørt, første forsøk feiler før run, tidlig feil etter eldre vellykket resultat, avbrutt worker, vanlig fullført run og aktiv kjøring. Verifiser korrekt siste/neste kontroll og lenke til eksisterende oppdrag. Bevar serverfiltrering; barn/delte skjermer skal ikke få nye rettigheter.

Dette er en visnings-/lesemodellretting. Ingen manuell kjøring, tolking, kopiering, ny aktivering eller endring av de to allerede koblede oppdragene, deres subjectmetadata, mottakere, godkjenning eller tidsplan.

## 5. Frys kalenderens tidsvindu gjennom hele pagineringen

`calendar/service.ts:syncConnection` kaller `windowFor()` inne i callbacken til `allPages`. Google-forespørslene får dermed nye `timeMin/timeMax` når klokken endrer seg mellom sider. Googles pagineringskontrakt krever samme forespørsel med neste `pageToken`. Kodeavviket er bekreftet; faktisk provideravvisning er ikke live-demonstrert.

Beregn ett stabilt tidsvindu for den aktuelle snapshot-innhentingen og bruk det gjennom alle sidene. Bevar avgrenset fullsnapshot-modell og eksisterende tidsone-/heldags-/gjentakelsesbehandling; dette bestiller ingen ny inkrementell synkarkitektur.

Test med en klokke som flytter seg og flere sider, inkludert en tom mellomside med neste token. Sammenlign forespørslene: bare sidetoken skal endres. Kontroller at ufullstendig innhenting eller sidefeil ikke trekker tilbake tidligere hendelser, og at fullført snapshot ikke lager duplikater.

Primærkilde: https://developers.google.com/workspace/calendar/api/guides/pagination.

## Kapasitet, bevaring og ferdigkontroll

Gjør en lesende kapasitetskontroll før tunge bygg/restore: ledig plass, Samvevs aktuelle byggbehov og nødvendige backup-/rollbackmarginer. Ikke gjenta fullbygg til disken fylles. Ingen bred Docker-prune, sletting av databaser/volumer/backuper/rollback-images, globale endringer eller inngrep i andre prosjekter. Eventuell opprydding må være entydig Samvev-spesifikk, gjenoppbyggbar og innen etablert autorisasjon. Hvis kapasitet krever operatør: fullfør kode og tilgjengelige tester først, dokumenter konkret plassbehov/tiltak og la eksisterende drift stå. Ingen fiktiv PASS eller deploypåstand.

- Bevar reelle data, kontoer, rettigheter, beskyttede profilbilder, oppdragskoblinger og LAN-demoens `admin/admin`. Begge miljøer skal fortsatt kjøre. Ingen reseed, passordreset eller tester mot ordinær QA-database; bruk eksisterende isolerte test-databasevern.
- Ingen nye eksterne samtykker, credential-importer, modellkall, manuelle retries eller betalt fallback for QA. Bevar én normal worker og allerede godkjente tidsplaner. Rapporter eventuell naturlig bakgrunnsaktivitet separat. Kalenderfeilene skal kunne etterprøves med isolerte providertransporter.
- Reproduser de fem feilene og legg til målrettede regresjonstester som feiler før og består etter rettingen. Følg prosjektets nødvendige samlede retest. Bevar eksisterende migrationsfiler/checksummer; bruk bare nødvendig additiv, idempotent reparasjon dersom lagrede data krever det. Dokumenter kompatibilitet og rollback.
- Lag nytt kildecheckpoint og sporbar runtime/build. Fullfør kanonisk bygg når kapasiteten tillater det; dokumenter faktisk byggemetode og begrensninger. Regenerer de 14 ordinære latest-bildene via gjeldende rutine og personvernmasker. Lag `round-10/` med målrettede bevis for berørte kalender-/personflyter i begge temaer, mobil og større skjerm. Bruk den syntetiske seks-personersfixturen (2 voksne/4 barn). Ingen plikt til å kopiere hele runde 9s bildematrise.
- Bevar felles design, NB/EN, tilgjengelighet, scroll og eksisterende visningsgrenser. Visuell kontroll skal gjelde faktisk rendret innhold; ikke gi egen endelig designgodkjenning.
- Publiser rettelsene til den allerede autoriserte offentlige testversjonen når kilde/build, review og backup-/restore-/rollback-forutsetningene er verifisert. Bruk etablert Samvev-driftsvei, uten ny SSH-etablering eller global proxyendring. Verifiser app/worker/database, inn-/utlogging, berørte flyter, tilgangsgrenser og SSE over faktisk HTTPS. Skill isolert leverandørtest fra ekte kontoverifikasjon; privat konto-/kalenderinnhold og hemmeligheter skal ikke i offentlige bevis.

Lever `ROUND_10_REPORT.md` og påkrevd prosjektstatus med ett resultat per funn, endrede filer, utførte tester, migrasjon/reparasjon, kilde- og byggbevis, backup/restore, faktisk deployet SHA og gjenværende brukerhandlinger. Oppgi source SHA, senere review SHA, round ID og direkte lenker. Bevar tidligere bevis med riktig kilde. OAuth/ICS/Spond/ChatGPT-oppsett som fortsatt krever eierens handling skal fortsatt stå tydelig som ikke live-verifisert.

DCO-signert commit/push bare til `feat/m3-family-hub`. Ingen PR, merge, main-/force-push, tag, release eller Actions-dispatch. Ikke stopp ved planen eller første rettede feil: fullfør alle tilgjengelige deler og avslutt med kort, etterprøvbar status.
