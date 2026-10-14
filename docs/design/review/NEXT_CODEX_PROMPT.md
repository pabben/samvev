# Samvev – runde 9: referansekomposisjon, tydelige detaljer og lokal AI-diagnose

Fortsett i samme Codex-økt og bevar utført arbeid. Runde 8 er publisert; den gamle SSH-/deployblokkeringen er lukket ut fra den nye rapporten. Gjennomfør denne avgrensede oppfølgingen med implementering, visuell iterasjon, relevante tester og autorisert testpublisering. Work er reviewer og endrer bare mailboxen; server-Codex implementerer og publiserer.

## Baseline og faktisk review

- Repo/branch: `pabben/samvev`, `feat/m3-family-hub`.
- Vurdert og dokumentert deployet kilde: `15d047192abd63f4be18a90108fe969096da78d0`.
- Ny offentlig review SHA: `bbe5d4edc6da1de2d309c5eb11898a825d22d384`.
- Ordinær lokal round ID: `20261013220837-15d04719-3db04bd7`.
- Offentlig testversjon: https://samvev.pabben.org/.
- Publiseringen endret ikke applikasjonskoden. `ROUND_8_PUBLIC_DEPLOY.md` erstatter tidligere BLOCKED-status; ikke start tilgangsoppsettet på nytt.

Work har kontrollert kilde/scope og hasher/dimensjoner for alle 50 publiserte offentlige bilder, lest rapport/checks/recovery/SSE, åpnet et representativt offentlig bildeutvalg og sammenlignet med den allerede vurderte runde 8. Ikke skriv at Work har åpnet alle 50 eller kjørt serverkontrollene på nytt. Ingen ny visuell P0/P1-regresjon ble funnet i utvalget. Rapporten registrerer 56 beståtte HTTPS-kontroller og nåværende restore PASS; dette er server-Codex sine utførte kontroller.

Offentlig bildesett viser én bevart syntetisk person med begrensede rettigheter og lite innhold. Det erstatter ikke den innholdsrike seks-personersprøven. Runde 8s isolerte hovedfixture er fortsatt seks personer, to voksne og fire barn; ordinær LAN har fem bevarte personer. Manglende administrative knapper i offentlig testkonto er ikke i seg selv feil.

Felles appskall, seks-personers reflow og offentlig testpublisering er levert. Nær identisk design og fungerende lokal AI er ikke godkjent. Brukerens krav om høyest mulig likhet med originalene står ved lag; grønn QA er ikke visuell godkjenning.

Les AGENTS, review-README, denne mailboxen, ROUND_8_REPORT, ROUND_8_PUBLIC_DEPLOY, relevante manifests/validation og gjeldende drifts-/restore-rutine. Følg prosjektets agentarbeidsflyt med én skrivende agent om gangen. Bruk publishing-checkouten; beskytt hoved-.git. Integrer nyere arbeid dersom featurebranchen har gått videre, uten reset eller overskriving.

## 1. Komposisjon nærmere originalene

Åpne de faktiske autoritative bildene:
- `docs/design/ChatGPT Image 24. sep. 2026, 23_51_09.png`
- `docs/design/ChatGPT Image 24. sep. 2026, 23_52_06 (4).png`

Sammenlign appflatene uten rom/rammer. Navnet er Samvev; merkevarefooter/slagord skal ikke tilbake. Fire-personers sammenligning er nyttig for referansen, men seks er normaltilstanden.

**Mørk desktop/display:** I `round-8/six-home/six-desktop-1920-dark.png` strekker seks familierader hovedpanelene fra omtrent y247 til y887. Dagens tre hendelser, morgendagens ene hendelse og to påminnelser får store tomrom; familiemeldingen havner helt nederst. Gjør familieradene og hovedradens høyde mer balanserte mot referansen, med seks tydelige identiteter og nyttig aktivitetstekst. Behold hel melding/handlinger med litt luft under på 1920×1080. Ikke løs det ved å skjule personer, krympe brødtekst eller klippe paneler. Bevar den fungerende lave iPad-/Shelly-komposisjonen.

**Få personer/tomt innhold:** Offentlig `home-desktop-light.png` viser én person til venstre, et stort ubrukt midtfelt og dagsplan helt til høyre. Tilpass grid og innholdshøyde til faktisk antall også ved 1–3, uten å strekke ett personkort over all bredden. Dette er en sekundær regresjonsprøve, ikke ny hovedfixture. Kontroller 1/4/5/6/8 og tom/rik tilstand. Bevar personvalg, ikke lag data for å fylle tomrom.

Bevar landskap/materialer fra runde 8 som utgangspunkt. Foreta bare målrettede justeringer der side-ved-side viser en klar gevinst; ikke start en ny generell bakgrunnsrunde eller legg til funksjoner fra referansen. Rapporter fortsatt avstand i proporsjoner, typografi og materialer ærlig, uten egen designgodkjenning.

## 2. Konkrete UI-detaljer

- **Fokusramme:** `member.tsx` fokuserer h1 ved fanebytte og `member-shell.css` tegner stor ramme med `h1:focus`, også etter museklikk. Synlig i offentlige Messages/People/AI/Oppdrag. Behold semantisk fokus, scroll-reset og skjermleserorientering; gjør synlig fokusbehandling tilpasset navigasjonsmåten. Tastaturfokus skal fortsatt være tydelig. Kontroller faktisk mus, tastatur og fokusretur – ikke fjern outlines globalt.
- **Kompakte personkort:** `round-8/six-home/six-ipad-landscape-light.png` og `six-shelly-1280-light.png` viser «1 oppføring» pluss «1 til», uten aktivitet. Vis en kort relevant tillatt tittel der det er plass, eller en forståelig detaljinngang når ingen forhåndsvisning vises. «N til» skal beskrive ytterligere oppføringer etter faktisk vist innhold. Bevar de korrekte totalene, inkludert oppføringer som bare finnes i detaljer; ingen skjult datatap eller nye tilganger.
- **Bursdag på mobil Beskjeder:** Den isolerte seks-personersfixturen viser en stor bursdagsflate for en bursdag 33 dager frem. Den skyver den aktuelle meldingen langt ned. Gjør kommende bursdag kompakt i denne oppgavevisningen, med navn/dato bevart og prioritet til faktiske beskjeder. Behold både Ny beskjed og Nå/Planlagt/Historikk.
- **Tilbakepil:** «Tilbake til Mer» peker visuelt mot høyre i offentlige Skjermer/Integrasjoner/Oppdrag/AI. Bruk konsekvent venstrepil for retur. Kontroller øvrige delte ikoner og lesbare språk-/temavalg uten generell komponentombygging.

## 3. AI-visning: leverandør og avgrensning

`round-8/public/ai-mobile-dark.png` viser «Valgt bruksvei: Lokal leverandør» sammen med «Åpne ChatGPT-kontoens forbruk». `ai-settings.tsx` gjengir lenken ubetinget i banneret. Gjør bannerets hjelp/lenke relevant for valgt lagret leverandør. Eventuell ChatGPT-lenke kan beholdes i tydelig merket ChatGPT-tilkobling/historikk. Ikke finn på en lokal kontrollpaneladresse, ny saldo eller ny fakturering.

Flytt den eksisterende forklaringen om konto-/husstandsavgrensning nær hovedtallene. Null i testkontoens oversikt og 226 rader globalt er ikke dokumentert som en tellefeil: de gjelder ulike avgrensninger. Behold korrekt serverfiltrering og skillet mellom lokale kall, ChatGPT-kredittanslag og tilsvarende API-scenario. Ikke utvid tilgang til andre husstanders forbruk eller introduser nye kostnadsantakelser.

## 4. Avgrenset diagnose av eksisterende lokale modellfeil

Publiseringsrapporten dokumenterer to allerede godkjente, daglige oppdrag som til sammen gjorde tre mislykkede lokale OpenAI-kompatible dispatchforsøk (`AI_UPSTREAM_ERROR` / `AI_RESPONSE_INVALID`). Ingen vellykket beskjed ble laget. De tre forsøkene er beholdt i historikken; to oppdrag er fortsatt aktive. Browser-QA utløste ingen modellkall. Ikke skriv at det ikke forekom providertrafikk på serveren.

Undersøk eksisterende Samvev-logger, redigert konfigurasjon, dispatch-/responsmetadata og relevant adapterkode lesende. Skill forbindelses-/HTTP-feil fra svarformat/parserfeil. Rapportér bekreftet årsak, underbyggede hypoteser og eventuell konkret manglende informasjon. Hemmeligheter, familieinnhold og rå modellprompter skal ikke publiseres. Ikke utforsk eller endre andre apper/servere.

Denne delen bestiller diagnose, ikke nye modellforsøk: ingen manuell kjøring, retry, modelloppdagelse, ChatGPT-samtykke, credential-import eller betalt fallback. Bevar eksisterende godkjente tidsplaner og én normal worker; ikke pause all bakgrunnsdrift eller endre cadence for QA. Nye naturlige planlagte forsøk må rapporteres som bakgrunnsaktivitet. Diagnose og UI-arbeid skal kunne fullføres uten en ny vellykket live modellrespons. Ikke kall lokal AI fungerende før det finnes gyldig bevis.

## Bevaring, kontroll og publisering

- Seks syntetiske personer (2 voksne/4 barn) forblir hovedfixture i isolert API/database. Bevar LANs fem personer, data, preferanser og admin/admin. Bevar offentlig eksisterende kontoer/data/rettigheter; ikke reseed eller gi testkontoen nye privilegier for screenshots.
- Bevar felles appskall på alle sider, persondetaljer, mobilens skriveinnganger/dagsplanprioritering, NB/EN, reduced-motion, safe areas, 44px trykkflater, synlig tastaturfokus og naturlig scroll ved lange tekster/200 % zoom.
- Bevar serverens husstands-/rollegrenser, display-grants, SSE, offline/utløp, autentisering og AI-pris-/dispatch-/refresh-rettingene. Ingen nye funksjoner eller migrasjoner er bestilt.
- Test målrettet faktisk oppførsel: mus/tastatur ved navigasjon, lesbart innhold ved antallsendringer, primærhandlinger og korrekte resttall, provideravhengig forklaring. Følg prosjektets påkrevde retest/etterreview/release-gate. Ikke likestill grønn geometri med god komposisjon.
- Ny kilde krever ny kildebundet runtime/build/capture via etablerte scripts. Regenerer alle 14 ordinære latest-bilder, arkiver forrige sett korrekt. Lag `round-9/` med seks-personers Home på fem viewporter/begge temaer, berørte sider/dialoger, nødvendige 1/4/5/8-regresjoner og referanse/før/etter. Unngå overflødige dubletter. Skill faktisk isolert transport fra eventuelle injiserte stresstester.
- Oppdater offentlig testversjon via den nå verifiserte immutable Samvev-driftsveien, med gjeldende backup-/restore-/rollback-rutine og faktisk HTTPS-etterkontroll. Generell deployautorisasjon er allerede gitt. Ingen endring av Pangolin/global konfigurasjon eller andre apper. Ikke gjør om tidligere gjennomført migrasjon eller historisk restore bare for å pynte rapporten; post-deploy recoverability-bevis er ikke retrospektivt pre-cutover-bevis.
- Offentlig testkonto kan fortsatt ha én person og begrensede rettigheter. Publiser bare egnet syntetisk bevis og merk dette tydelig; seks-personersdesign valideres separat. Skjermbilder med privat konto-/provideroppsett skal fortsatt holdes private.

Skriv ROUND_9_REPORT og påkrevd prosjektstatus. Skill designfunn, AI-diagnose, tester, offentlige etterkontroller og uavklarte begrensninger. Oppgi ny source SHA, review SHA, faktisk deployet SHA og direkte lenker. Bevar gamle bevis med sine gamle kilder; ingen gjenbruk som påstått ny capture.

DCO-signert commit/push kun til `feat/m3-family-hub`. Ingen PR, merge, main-/force-push, tag, release eller Actions-dispatch. Ikke skriv egen endelig designgodkjenning i mailboxen. Lever hele runden; stopp bare ved en konkret tilgangs-/beslutningsblokkering som faktisk krever brukerinnsats.
