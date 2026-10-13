# Samvev – runde 8: lys familieoversikt med fem personer

Dette er neste samlede bestilling fra Pabben. Utfør den når han aktiverer mailboxen i server-Codex. Gjennomfør implementering, visuell iterasjon, nødvendige tester og publisert review-evidence autonomt. Ikke stopp ved en plan eller første CSS-justering. Work gjør neste designreview; server-Codex implementerer.

## Branch og vurdert kilde

- Repository: `pabben/samvev`.
- Arbeidsbranch: `feat/m3-family-hub`.
- Kontrollert branch-head/review SHA: `64bb5896d8b0c2684ba7ec4cd1e2b439fcc5f99b`.
- Vurdert UI/source SHA: `f65d75f55cdf3ed0a7fd2915e97d045923c6e35c`.
- Round ID: `20261013194236-f65d75f5-ba8caa81`.
- Forrige sammenligning: runde 6, source `158d9e33949715403998b914d2180d95b66e9ae3`, review `094624f8af6449870fc5f253f128f5df928e3fac`.

Mailbox-commiten kommer etter review-commiten og endrer ikke hvilken kilde bildene viser. Hent siste featurebranch gjennom etablert `.local/design-review-publish`, bevar nyere arbeid og ikke reset til SHA-ene over. Ikke endre beskyttet hoved-`.git`.

Les `AGENTS.md`, relevante prosjektkrav/ADR-er, `docs/design/review/README.md`, `latest/manifest.json`, `round-7/manifest.json`, `ROUND_7_REPORT.md`, `round-7/validation.json` og denne prompten. Følg repoets agentarbeidsflyt og påkrevde etterreview/retest/release-gate, med én skrivende agent om gangen. Denne runden gjelder avgrenset frontendkomposisjon og visuell kontroll.

## Reviewkonklusjon og lukkede funn

Work har faktisk åpnet begge originalreferansene, alle 14 ordinære og alle 21 supplerende runde-7-screenshots, de to avledede sammenligningsbildene og relevante runde-6-bilder. Alle 35 nye bildehasher og dimensjoner er kontrollert. Begge manifester peker på ny source SHA. Manifestets oppgitte input-/root-/clone-fingeravtrykk samsvarer. Dette er ikke en ny kjøring av serverens tester eller en full ny reproduksjon av runtimebeviset.

De konkrete runde-7-funnene kan lukkes:

- Lys mobil viser «Ny beskjed» i både tom og fylt tilstand og beholder neste hendelse i den avtalte firepersonersfixturen. Kode og testinnhold underbygger faktisk åpning, publisering, avbryt, Escape og fokusretur.
- Mørk desktop/display viser begge påminnelsene. Kompakte flater beholder ett prioritert preview og inngang til resten.
- Mørk iPad portrait bruker hele påminnelsesbredden uten å dele «Foreldremøte» midt i ordet.
- Mørk Shelly viser hele nedre kontrollflate i den korte firepersonersfixturen.
- AI-oversikten skiller bekreftet utsending, uavklarte forsøk og kjent kostnadsanslag. Ikke endre denne igjen uten konkret ny feil.
- Lys bakgrunn er roligere. Mørk steinforgrunn er dempet, og glasslag/kanter er forbedret. Dette er en faktisk forbedring, selv om originalens materiale ikke er fullt gjenskapt.

Ingen nye P0 funnet. Ett nytt P1-komposisjonsgap må rettes. Det er utløst av fem personer, ikke påvist som en ny kode-regresjon. Ingen ny backend-, OAuth-, pris-, provider- eller migrasjonsrunde er bestilt. Rapportens 272/272 tester er lest, ikke kjørt på nytt av Work. Live ChatGPT-samtykke, kontotilgang og faktisk belastning er fortsatt uverifisert og er ikke en avslutningsgate for denne UI-runden.

Pabbens mål er fortsatt høyest praktisk visuell paritet. Vi erklærer ikke «nær identisk» eller endelig designgodkjenning. Bevar de forbedrede hovedkomposisjonene; ikke gjør en ny generell redesign.

## Autoritative referanser og vurderte bilder

Åpne faktisk disse originale PNG-filene:

- `docs/design/ChatGPT Image 24. sep. 2026, 23_51_09.png`
- `docs/design/ChatGPT Image 24. sep. 2026, 23_52_06 (4).png`

De overstyrer eldre SVG-er/mockups. Sammenlign appflatene, uten rom, skjermrammer og collage. Samvev-navnet beholdes; navn, tekster og eksempeldata i originalene skal ikke hardkodes. Footeren med Samvev/slagord skal fortsatt være borte. Displayets faktiske delings-/oppdateringsinformasjon beholdes.

Ordinært vurdert sett under `docs/design/review/latest/`:

| Viewport | Lys | Mørk |
|---|---|---|
| 1920×1080 | desktop-1920-light.png | desktop-1920-dark.png |
| 390×844 | mobile-light.png | mobile-dark.png |
| 820×1180 | ipad-portrait-light.png | ipad-portrait-dark.png |
| 1180×820 | ipad-landscape-light.png | ipad-landscape-dark.png |
| 1280×752 | shelly-1280-light.png | shelly-1280-dark.png |

Full-page-supplement: `desktop-1920-light-full.png`, `desktop-1920-dark-full.png`, `mobile-light-full.png`, `mobile-dark-full.png`.

Vurdert supplement under `docs/design/review/round-7/`: de ti viewportfilene fra tabellen med rik isolert tilstand; `display-1920-light.png`, `display-1920-dark.png`; `person-desktop-light.png`, `person-desktop-dark.png`, `person-mobile-light.png`, `person-mobile-dark.png`; `ai-overview-desktop-light.png`, `ai-overview-desktop-dark.png`, `ai-overview-mobile-light.png`, `ai-overview-mobile-dark.png`; `compose-mobile-light.png`. Sammenligningsarkene ligger i `round-7/comparisons/`, er avledede bilder og erstatter ikke originalene eller viewportbilder.

Datatilstandene er forskjellige: ordinær LAN har fem bevarte personer og naturlig tomme dager; rik isolert fixture har fire personer, ni Home-elementer, tre hendelser i dag og én menneskelig melding. Rapporten oppgir at den femte LAN-personen allerede fantes før runden og at navnene er brukerbekreftet syntetiske. Bevar alle personer og valg. Initial-avatar uten eksplisitt illustrasjonsvalg er gyldig, ikke en feil som skal repareres ved å endre data.

## P1-A – tilpass lys storflate til fem personer

Funnene er synlige i `latest/desktop-1920-light.png`, `latest/ipad-landscape-light.png` og `latest/shelly-1280-light.png`. Full-page desktop er 1920×1490: fire personkort står i første rad; femte person får et like høyt kort alene under. Personområdet blir omtrent 1100 px høyt, dagsplanen strekkes tilsvarende, og hele støtte-/meldingsraden skyves under første viewport selv med null innhold. På liggende iPad/Shelly oppstår samme ubalanse. Informasjonen finnes ved scrolling; dette er dårlig komposisjon og unødvendig tomflate, ikke utilgjengelig innhold.

Koden underbygger årsaken: `home.css` bruker fast `repeat(4,...)`, minimum 545 px per lyst personkort på høy storflate og 335 px på lav storflate, mens personområdet og dagsplanen deler en strukket ytre rad. Ikke legg enda en vilkårlig høyde over denne kombinasjonen.

Tilpass antall kolonner, kortform og eventuell radhøyde til tilgjengelig panelbredde og antall personer:

- På 1920×1080 skal fem personer kunne stå i én balansert rekke sammen med dagsplanen, med fortsatt tydelige avatarer, personfarger og navn. Utvid til fem kolonner der faktisk bredde tillater det. Behold romslighet og lesbarhet, og bevar den gode firepersonerskomposisjonen.
- Ved 1180×820 og 1280×752: prøv fem lesbare kort på én rad eller en kompakt, balansert gruppe med lavere kort på flere rader. Ikke behold fire høye kort pluss ett enslig høyt kort. Dersom det blir flere rader, skal hele gruppen ha en sammenhengende kompakt rytme; dagsplanen skal ikke arve flere tomme minimumshøyder.
- Den avgrensede fempersonersfixturen skal vise alle fem identiteter, dagens tre korte hendelser, påminnelsesinngang og en menneskelig melding med avsender i første viewport på disse tre brede størrelsene. Hele nødvendige kontrollflater skal være synlige. Kortinnhold kan oppsummeres gjennom eksisterende tellinger og persondetaljer. Ikke skjul femte person eller resten av dataene.
- Den faktiske tomme LAN-tilstanden skal også få en samlet førsteskjerm med fem personer, i dag/i morgen og nedre støtte-/meldingsområder. Ikke redater, reseed, fjern eller endre personer for å oppnå dette.
- Regler skal bruke reelt persontall og tilgjengelig bredde, ikke navn, fixture-ID eller antakelsen om fire medlemmer. Kontroller overgangene 4→5→6 og videre til åtte. Lange navn, mer innhold, små skjermer og 200 % zoom kan fortsatt scrolle naturlig.

Ikke innfør global `overflow:hidden`, horisontal hovedscroll, fast klipping eller en karusell som gjør personer usynlige for å bestå et screenshot. Behold alle direkte personinnganger, fokusretur og semantisk leserekkefølge. Ikke reduser all tekst for å få plass. En lokal justering av personområdets komposisjon er autorisert; den gode mørke hovedstrukturen og firepersoners grunnlayout skal bevares.

## P2-B – én avgrenset prøve mot mørk referanse

Mørk original viser en fjellrygg bak hilsenen og en smal varm horisont nær overkanten av kortene. Dagens brede visning viser mer himmel bak hilsenen, mens fjellene i større grad havner bak panelene. Originalen har dessuten mer lokal blålig refleksjon i øvre del av høyre paneler; dagens flater er mer ensartede.

Prøv et moderat høyere utsnitt av eksisterende landskapsressurs på bred mørk Home/display. Behold rolig mørkt tekstunderlag og den nylig dempede steinforgrunnen. Prøv eventuell lokal lysvariasjon i øvre tredel av høyre glass-/innholdsflater, uten å lysne alle kort eller legge sterk glød rundt dem. Dette skal være en liten sammenlignbar materialjustering, ikke en ny bakgrunn, ny hero-struktur eller ny generell «mer glass»-runde.

Åpne original, runde 7 og kandidat ved samme appbredde. Behold endringen bare dersom den gir tydeligere referanselikhet uten mer uro eller dårligere lesbarhet. Hvis forsøket er svakere, behold runde-7-materialene og dokumenter hvorfor. Ingen nye art-assets er nødvendig. Lys materialbestilling fra runde 7 lukkes: behold den roligere bakgrunnen og dokumenter forskjellen fra referansens organiske innramming; ikke legg tilbake store grønne flekker.

## Hva som skal bevares

- Samvev-navn, fjernet merkevarefooter, valgte avatarer/farger og korrekt initial-fallback. Ingen dataendring for kosmetikk.
- Nye skriveinnganger, gjeldende preview-prioritering og tellinger, iPad-påminnelsesbredde, Shelly-kontroller, persondetaljer, fulltekst, sted, tidsintervall, kildeopplysninger og person-/husstandsgruppering.
- AI-oversikt, tall og språkavgrensninger fra runde 7, tidligere pris-/dispatch-/refresh-/companion-rettelser og fravær av automatisk betalt fallback. Ingen nye AI-funksjoner, API-endringer eller migrasjoner forventes.
- Eksisterende autentisering, serverfiltrert Home, display-grants, eier-/husstandsgrenser, lesende/barnetilganger, SSE og utløp/offline. UI-komposisjon gir ikke nye rettigheter.
- LAN med `admin/admin`, alle nåværende personer og eksisterende data/passord/preferanser/avatarvalg. Ingen reset, reprovisionering, reseed, redatering eller endring av beskyttet hoved-`.git`.
- Ingen private data, ekte kontoidentitet/saldo, tokens eller hemmeligheter i Git/evidence. Ingen betalte/live modellkall trengs. Ikke hent eller kopier Codex' credentials.

## Responsivitet og tilgjengelighet

Kontroller de fem etablerte viewportene i begge temaer. De nye førsteskjermmålene gjelder fem personer med kort, avgrenset innhold på 1920×1080, 1180×820 og 1280×752. På mobil/iPad portrait skal fem personer fungere med naturlig reflow og full tilgang; ikke innfør et ubekreftet krav om at alle fem med fullt innhold må få plass i første viewport.

Bevar firepersonersmålene: lys mobil har skriveinngang og neste hendelse; mørk mobil har tre komplette korte dagsplanrader over bunnavigasjonen; begge iPad portrait har påminnelse og familiemeldingsinngang med avsender i første viewport. Mørke brede flater viser avtalt antall påminnelser. Samme produkt skal fortsatt gjenkjennes på tvers av størrelse og tema.

Minst 44×44 trykkflater, synlig fokus, semantiske knapper/lenker, korrekt leserekkefølge, Escape/fokusretur og ingen nestede interaktive elementer. Kontroller resize/temaskifte med persondetalj åpen, og at riktig person og fokus beholdes. Behold NB/EN, reduced-motion og safe areas. Ingen horisontal overflyt eller tap av informasjon ved ekte 200 % nettleserzoom. Mål WCAG AA på faktiske kompositerte flater etter materialendring, inkludert fallback uten backdrop blur.

## Akseptanse og verifikasjon

1. Fem personer gir ikke lenger én ekstra høy, nesten tom kortrad på lys desktop/landscape/Shelly. Alle fem har synlig og lesbar identitet; melding/påminnelse og dagsplan oppfyller de avgrensede førsteskjermmålene.
2. Både tom fempersoners LAN-tilstand og rik isolert fempersoners tilstand er faktisk åpnet og vurdert. Sistnevnte har tre korte dagsplanhendelser, påminnelser, én menneskelig melding og noe personlig innhold også for person fem.
3. Den gode firepersonerslayouten og runde-7-fiksene er bevart. 4/5/6/8 personer, lange navn/tekster, tema/resize og 200 % zoom fungerer uten tapt tilgang. Det er tillatt med naturlig scrolling ved større datamengder.
4. Materialprøven er sammenlignet med runde 7/originalen og enten beholdt med konkret visuell begrunnelse eller forkastet. Ikke påstå nær-identisk design ut fra testresultater.
5. QA-data, protected Git, source/runtime/build-provenance og faktisk innlogging er bevart/kontrollert etter etablert rutine.

Kjør `npm run check --workspace @samvev/web`, `npm run test --workspace @samvev/web`, review-rutinens beviste web-build og repoets påkrevde komplette retest, etterreview og release-gate. Følg faktisk registrerte scripts. Legg bare til meningsfulle tester for den nye adaptive atferden og eventuelle regresjoner.

Det konkrete evidensgapet i runde 7 er at 1/4/8-stresstesten tester lys mobil eller mørk iPad, ikke fem personer på lys storflate. Dekk nå fem personer på alle tre berørte brede størrelser i lys og mørk. Bruk faktiske isolerte API-/databasetilstander for det publiserte rike settet. Injiserte ekstra stresstester kan brukes når de merkes eksplisitt og ikke framstilles som reelle baseline-captures.

Kontroller synlighet og geometri på hele relevante kort/handlinger, ikke bare antall DOM-elementer. Åpne femte persons detaljer og avtalte melding-/samleinnganger; test riktig innhold og fokusretur. Unngå tester som bare gjentar valgt CSS-kolonneantall eller et nytt min-height-tall. Kjør relevante M3-, Axe-, kontrast-, zoom- og fallback-kontroller for endret risiko samt påkrevde gates. Ikke legg til en ny generell backend-/live OAuth-gate.

Åpne kandidatbildene faktisk og iterer til det konkrete fempersonersavviket er borte. Ikke stopp ved en grønn geometritest dersom komposisjonen fortsatt er ubalansert.

## Capture, rapport og publisering

Bruk etablert workspace og Compose-prosjekt `samvev-m1`; ikke andre prosjekter eller host-global konfigurasjon. Lag DCO-signert source-checkpoint i `.local/design-review-publish` og gjør tillatte QA-inputs byte-identiske uten å skrive til beskyttet hoved-`.git`. Følg review-README og dens låser/provenance/databevaring:

```bash
bash scripts/design-review-runtime.sh
bash scripts/design-review-build.sh
# Målrettet nettleser-QA av denne kandidaten.
bash scripts/design-review.sh
```

Dette er avgrenset QA-forberedelse, ikke produksjonsdeploy. Source, runtime, byggebevis, serverte assets og manifest skal samsvare. Ingen rebuild etter endelig capture uten ny nødvendig QA/capture.

Regenerer og åpne alle 14 ordinære latest-bilder med eksakte navn over. Arkiver forrige gyldige sett byte-identisk. Kontroller source SHA, round ID, viewport, tema, dimensjoner og SHA-256. Bruk viewportbildene som hovedgrunnlag og full-page som supplement.

Publiser et avgrenset `docs/design/review/round-8/`-sett med manifest som entydig skiller datatilstand, kilde, viewport og tema:

- Rik **fempersoners** Home på alle fem viewporter i begge temaer. Bevar faktisk LAN; opprett denne fixturen bare i isolert syntetisk testdatabase.
- Rik **firepersoners** desktop 1920 i begge temaer for direkte sammenligning av hovedkomposisjon/materiale med runde 7. De øvrige firepersonersmålene verifiseres i nettleser-QA; ikke produser mange like bilder uten reviewverdi.
- Faktisk paired display med fem personer på 1920 i begge temaer, med eksisterende display-grants og uten compose.
- Full-page for rik lys fempersoners desktop dersom viewport ikke alene dokumenterer hele resultatet. Full-page på andre berørte flater ved behov for å vise scrolling/reflow ærlig.
- Persondetaljer, compose og AI trenger relevant regresjonskontroll; regenerer supplerende bilder bare hvis deres utseende eller atferd faktisk påvirkes. Ingen nye uendrede OAuth-oppsettbilder eller live-kontobevis er nødvendig.

Bruk tydelig forskjellige filnavn/undermapper for fire/fem personer. Oppdater eventuelle avledede sammenligningsark med korrekt referanse-/baseline-/kandidatgrunnlag; merk perspektivnormalisering som omtrentlig. Slike ark teller ikke som UI-captures. Latest-kontrakten forblir 14 ordinære bilder.

Skriv `docs/design/review/ROUND_8_REPORT.md` og oppdater prosjektstatus der repoet krever det. Oppgi endrede filer, konkrete før/etter-funn, hvilke krav som faktisk er lukket, tester og begrensninger, avgrenset materialbeslutning og databevarende rollback. Ingen migrasjon forventes. Hold de etablerte QA-tjenestene healthy og bekreft UI-innlogging/utlogging med `admin/admin` uten passordendring.

Commit med DCO-signoff og push kun featurebranchen:

```bash
git push origin feat/m3-family-hub
```

Rapporter source SHA, review SHA, round ID og lenker. Ingen PR, merge, deploy, main-push, force-push, tag, release eller Actions-dispatch. Ikke skriv egen designgodkjenning i mailboxen; Work gjør neste review av publiserte bilder.
