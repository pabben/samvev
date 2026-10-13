# Samvev – runde 7: lukk responsive restavvik og kalibrer materialene

Dette er neste samlede implementeringsbestilling fra Pabben, aktivert når han ber server-Codex utføre mailboxen. Gjennomfør endringene, visuell iterasjon, nødvendige tester og publisert review-evidence autonomt. Ikke stopp ved en plan eller første CSS-justering.

## Grunnlag og retning

Repository: `pabben/samvev`. Branch: `feat/m3-family-hub`.

- Kontrollert branch-head/review SHA: `094624f8af6449870fc5f253f128f5df928e3fac`.
- Vurdert UI/source SHA: `158d9e33949715403998b914d2180d95b66e9ae3`.
- Round ID: `20261012234005-158d9e33-d7fb5bdb`.
- Sammenligningsgrunnlag fra runde 5: source `b6a30b2d95443a02192da7bc089820585fde8169`, review `b65842b1034ceae07d8e296874e3418779fa316d`.

Mailbox-commiten kommer etter review-commiten og endrer ikke hvilken UI-kilde bildene viser. Hent siste featurebranch gjennom etablert `.local/design-review-publish`. Bevar nyere arbeid; ikke reset til SHA-ene over eller endre hovedcheckoutens beskyttede `.git`.

Les `AGENTS.md`, relevante prosjektkrav/ADR-er, `docs/design/review/README.md`, `latest/manifest.json`, `round-6/manifest.json`, `ROUND_6_REPORT.md` og denne prompten. Følg prosjektets agentarbeidsflyt, med én skrivende agent om gangen, etterreview og release-gate. Denne runden er avgrenset til UI, presentasjon og nødvendig målrettet verifikasjon. Ikke start en ny generell AI-/OAuth-/migrasjonsrunde.

Pabbens retning gjelder fortsatt: så høy visuell paritet med de to autoritative bildene som praktisk mulig. «Pent», «samme stil» og en selvvalgt poengsum er ikke godkjenning. Samvev-navnet beholdes; referansenes navn, tekster og eksempeldata skal ikke hardkodes.

## Faktisk review og hva som er lukket

Work har åpnet begge originale PNG-filer, alle 14 ordinære og alle 22 supplerende runde-6-bilder, og sammenlignet relevante rike visninger med runde 5. Alle 36 nye bildehasher og dimensjoner er kontrollert. Manifestene peker på ny source SHA, og oppgitte root/build/publishing-fingeravtrykk samsvarer. Work har lest rapport, relevante rettelser og regresjonstester, men har ikke kjørt serverens testpakke eller live OAuth.

Følgende tidligere funn er løst i den avtalte rike tilstanden og skal ikke åpnes som nye generelle ombygginger:

- Lys desktop har fått støtte–melding–støtte under hovedraden, med den menneskelige meldingen sentralt.
- Mørk mobil viser tre komplette dagsplanrader, og lys mobil viser neste hendelse.
- Begge iPad portrait viser påminnelse og familiemeldingsinngang med avsender i første viewport.
- Personnavn/pil er forbedret, avatarvalgene beholdt, og lys paired display bruker samme bakgrunnsfamilie som Home.
- Persondetaljene viser tidsintervall, sted, full tekst og skille mellom person-/husstandsinnhold.
- AI åpner på en kompakt forbruksoversikt. De konkrete pris-/ukjent-dispatch-feilene og refresh-/companion-funnene fra forrige mailbox er rettet ved kildekontroll og dekket av relevante rapporterte tester.

Ingen nytt P0-avvik er identifisert i denne gjennomgangen. Det betyr ikke at materialer og alle detaljer har oppnådd høy referanseparitet. Neste runde skal lukke de konkrete restavvikene nedenfor og bevare den nå fungerende komposisjonen.

## Visuell fasit og bilder

Åpne faktisk begge autoritative referanser:

- `docs/design/ChatGPT Image 24. sep. 2026, 23_51_09.png`
- `docs/design/ChatGPT Image 24. sep. 2026, 23_52_06 (4).png`

Sammenlign selve appflatene, ikke skjermrammer, rom eller collage. Originalene overstyrer eldre SVG-er/mockups. Footeren med Samvev/slagord skal fortsatt være borte. Displayets nødvendige informasjon om deling/oppdatering er noe annet og beholdes.

Vurderte ordinære bilder i `docs/design/review/latest/`:

| Viewport | Lys | Mørk |
|---|---|---|
| 1920×1080 | desktop-1920-light.png | desktop-1920-dark.png |
| 390×844 | mobile-light.png | mobile-dark.png |
| 820×1180 | ipad-portrait-light.png | ipad-portrait-dark.png |
| 1180×820 | ipad-landscape-light.png | ipad-landscape-dark.png |
| 1280×752 | shelly-1280-light.png | shelly-1280-dark.png |

I tillegg: `desktop-1920-light-full.png`, `desktop-1920-dark-full.png`, `mobile-light-full.png`, `mobile-dark-full.png`.

Vurdert supplement i `docs/design/review/round-6/`: de samme ti viewportfilene fra tabellen med rik, isolert tilstand; `display-1920-light.png` og `display-1920-dark.png`; `person-desktop-light.png`, `person-desktop-dark.png`, `person-mobile-light.png`, `person-mobile-dark.png`; `ai-overview-desktop-light.png`, `ai-overview-desktop-dark.png`, `ai-overview-mobile-light.png`, `ai-overview-mobile-dark.png`; `ai-connection-mobile-dark.png` og `ai-recovery-mobile-dark.png`.

Ordinær LAN har naturlig tomme dager etter utløpt innhold. De rike bildene kommer fra isolert syntetisk API/database. Bare recovery-bildet bruker eksplisitt DTO-injeksjon. Ingen av disse beviser faktisk kontosamtykke eller kredittbelastning. Ikke redater/reseed LAN for å gjøre bildene penere.

## Fem prioriterte grep

### P1-A – gjeninnfør synlig skriveinngang på lys mobil

I både `round-6/mobile-light.png` og den tomme `latest/mobile-light-full.png` mangler en synlig «Ny beskjed»-handling. Runde 5 hadde den i meldingskortet. Tomtilstanden oppfordrer nå brukeren til å legge igjen en hilsen uten å tilby en synlig handling der. Mørk mobil har fortsatt en tydelig skriveinngang.

Gi lys mobil en kompakt, eksplisitt skriveknapp i familiefeeden når brukeren allerede har skrivetilgang. Gjenbruk `onCompose` og eksisterende meldingsflyt. Knappen skal være synlig både med og uten meldinger, og kunne åpne skriving direkte fra Home. Plasser den for eksempel ved meldingsområdets overskrift; ikke gjeninnfør den store høyden fra runde 5.

Bevar synlig neste dagsplanhendelse ved 390×844 i den rike tilstanden. Knappen må ha forståelig tekst/tilgjengelig navn, minst 44×44 trykkflate og fungerende fokusretur. Ikke gi paired display eller andre lesende roller ny skriverett. Kontroller faktisk åpning, avbryt og en syntetisk innsending i isolert testmiljø.

### P1-B – tilpass påminnelsespreview til flaten

Mørk desktop og faktisk display viste begge påminnelsene i runde 5. Nå vises bare én og «Se Verdt å huske · 2 totalt», mens store deler av panelet står tomt. Koden har en generell `const previewLimit=1` i `apps/web/src/family-hub.tsx`; den kompakte mobilprioriteringen har dermed også redusert en stor flate unødvendig.

La tilgjengelig flate og komposisjon styre preview. Mørk desktop/display med den avgrensede to-påminnelsesfixturen skal vise begge samtidig. Vis flere når de faktisk får plass, med tydelig inngang til resten ved større mengder. Behold prioritering og totalantall; ikke hardkod de to tekstene eller eksempelpersonene.

Mobil skal fortsatt ha ett prioritert fokuspunkt. Den lave lyse støtteraden og smale iPad-paneler kan fortsatt vise én påminnelse med inngang til resten. Ikke endre hele hovedraden eller presse all tilgjengelig informasjon inn på alle størrelser. Kontroller 0/1/2/flere påminnelser, inkludert lange titler, slik at løsningen ikke bare passer den korte fixturen.

### P1-C – ferdigstill to konkrete responsive detaljer

**Mørk iPad portrait:** I `round-6/ipad-portrait-dark.png` bruker den ene påminnelsen omtrent halve innvendige panelbredden. «Foreldremøte» brytes som «Foreldremøt / e i morgen», mens høyresiden står tom. La et enkelt preview bruke hele tilgjengelige bredden i dette smale panelet. Sett hensiktsmessig innvendig grid ut fra faktisk panelbredde/antall; ikke bare viewportens bredde. Naturlig linjebryting ved mellomrom skal virke før ord deles. Behold to kolonner i ytre layout og den synlige familiemeldingen.

**Mørk 1280×752:** I `round-6/shelly-1280-dark.png` ligger «Se Litt mer oversikt · 3 totalt» i nederste viewportkant. Bildet viser bare deler av kontrollen. Dette beviser ikke at den er utilgjengelig etter scrolling, men det er en uferdig førsteskjermkomposisjon i den avtalte korte tilstanden. Frigjør den nødvendige høyden gjennom lokal spacing og person-/panelrytme slik at nedre rad og kontrollenes komplette trykkflater har plass, med litt luft til kanten. Ikke skjul kontrollen, fjern nyttig melding eller krymp teksten.

Bevar lesbar reflow med lengre tekst, åtte personer og 200 % zoom. Slike tilstander kan scrolle naturlig; ikke innfør global `overflow:hidden` eller en fast høyde som klipper innhold. Lys 1280×752 og begge 1180×820 må kontrolleres samtidig for regresjoner.

### P1-D – avgrenset materialkalibrering mot originalene

Strukturen matcher bedre enn overflatematerialene. I mørk desktop/display fremstår flere paneler fortsatt som ensartede, nesten ugjennomsiktige navyflater. Originalen har tydeligere forskjell mellom bakgrunn, gjennomlyst ytre glass og indre innholdsflater, med subtile refleksjoner og lyskanter. Det detaljerte steinlandskapet nedenfor og mellom panelene tar fortsatt mye visuell plass.

Kalibrer eksisterende bakgrunnsbehandling, gjennomlysning, blur, overlys, border og skygge som én helhet. Demp forgrunnsdetaljene bak innholdet og la landskapet gi ro rundt hilsenen. Gi innvendige påminnelses-/personflater og den menneskelige meldingen passende dybde uten å lysne hele dashboardet eller sette kraftig glød rundt alle kort.

I lys modus beholdes varme leseflater, pastellpersoner og blå/mint-atmosfære. De store diffuse grønne formene skal være en rolig organisk innramming, med mykere overgang mot hovedflaten, ikke dominerende fargeflekker. Kalibrer mot lysreferansens appflate. Behold de nå gode kortproporsjonene og den tredelte nedre raden.

Dette er ingen ny grid-, avatar-, font- eller funksjonsombygging. Bruk eksisterende lokale ressurser og tokens der mulig. Ikke legg inn falske vær-/smarthjemkontroller eller nye dekorative støttewidgets for å kopiere eksempelinnhold. Sammenlign normalisert appbredde side ved side med originalen; en ny gradient alene er ikke dokumentasjon på at materialgapet er lukket.

### P2-E – gjør forbrukstallene enklere å tolke

AI-oversikten er betydelig bedre og skal beholde fanene og kompakt førsteskjerm. Den rike fixturen viser «5 forespørsler» og samtidig «4 priset · 2 ukjente forsøk». Tallene har forskjellige omfang: fem bekreftede utsendinger, hvorav fire med kjent pris, samt ett uavklart utsendingsforsøk. Det er ikke en ny påvist regnefeil, men forklaringen krever for mye tolkning.

Gjør dette synlig med korte, presise etiketter og eksisterende data: skill bekreftede utsendinger fra uavklarte forsøk, og merk kredittbeløpet som et anslag for den kjente delen. Behold at USD er et separat API-scenario, at ukjente beløp er utelatt, og at saldo/prognose kan være ukjent. Det må være forståelig uten å åpne tekniske detaljer.

Ikke beregn rutespesifikke delmengder ved å trekke globale summer fra hverandre; de kan ha forskjellig periode, provider eller kategori. Hvis eksisterende respons ikke gir en sikker detaljfordeling, forklar omfanget kvalitativt og behold aggregerte tall. Ikke hardkod fixturetall, endre backendregnskapet eller introduser nye API-/skjemaendringer for denne språkpoleringen. Behold NB/EN. Det er fortsatt ingen verifisert faktisk kontotilkobling, saldo, utløpsdato eller belastning.

## Hva som skal bevares

- Samvev-navn, eksplisitte avatarvalg, eksisterende personfarger, direkte persondetaljer, tidsintervaller, kilder, person-/husstandsgruppering og fjernet merkevarefooter.
- Lys og mørk beholder sine egne komposisjoner; ingen ny generell gridrunde. Bevar avtalte mobil-/iPad-prioriteringer og faktisk displaygrense.
- Eksisterende autentisering, serverfiltrert Home, display-grants, husholds-/eiergrenser, SSE, utløp/offline, kildeinformasjon og konto-/barnetilgang.
- Runde-6-rettingene i AI-prissnapshots, ukjent dispatch, kryptert refresh-recovery, companion-registrering og fravær av automatisk betalt fallback. Ikke reåpne lukket backendarbeid uten en konkret reproduksjon av ny feil.
- Bevar LAN-data, passord, preferanser og avatarvalg. `admin/admin` skal fungere i syntetisk QA uten reset. Ingen reseed, redatering, sletting, reprovisionering eller endring av beskyttet hoved-`.git`.
- Ingen private husstandsdata, ekte kontoidentitet/saldo, tokens eller hemmeligheter i Git eller evidence. Ingen live/betalte modellkall er nødvendig i denne runden. Ikke hent eller kopier Codex' credentials.

## Responsivitet og tilgjengelighet

Kontroller alle fem etablerte viewporter i lys og mørk, med både ordinær tom tilstand og den isolerte rike fixturen. Behold desktopens sammenhengende hovedrader og iPads to-kolonnestruktur. Ved 390×844 skal lys ha synlig skriveinngang og neste hendelse; mørk skal fortsatt vise tre komplette korte dagsplanrader over bunnavigasjonen. Ved 1280×752 skal den korte fixturens nedre kontrollflater være komplett synlige.

Dette er normalzoom-mål for den avgrensede fixturen, ikke et løfte om at alle data får plass. Kontroller også 1/4/8 personer og lengre titler. Lang tekst, flere elementer og 200 % faktisk nettleserzoom får bruke naturlig scrolling og reflow. Ingen horisontal overflyt eller tap av informasjon/handlinger.

Behold minst 44×44 trykkflater, synlig fokus, semantiske knapper/lenker, riktig leserekkefølge, Escape/fokusretur og ingen nestede interaktive elementer. Mål WCAG AA på faktiske kompositerte flater etter materialendringene, inkludert uten backdrop blur. Person/status må forstås uten bare farge. Behold reduced-motion og NB/EN.

## Akseptanse og tester

Runden er ferdig når:

1. Lys mobil viser og åpner skriving direkte, både med og uten eksisterende melding, uten å skyve den avtalte neste hendelsen ut av første viewport.
2. Mørk storflate viser begge påminnelsene i den rike fixturen; mobil og lave lyse støttefelt beholder riktig prioritering. Restinnhold kan åpnes, og antall stemmer.
3. Mørk iPad bruker den tilgjengelige påminnelsesbredden uten å splitte den vanlige testtittelen midt i ordet. Mørk Shelly har komplett nedre kontrollflate ved 1280×752. Øvrige formatmål er bevart.
4. Side-ved-side-bilder viser reell, rolig materialforbedring mot originalene, med beholdt lesbarhet og eksisterende hovedkomposisjon. Dokumenter konkrete restforskjeller; ikke erklær nær identisk design ut fra grønne tester.
5. AI-oversiktens etiketter forklarer bekreftet, uavklart og kjent kostnadsdel uten å endre beløpene eller framstille estimatet som kontosaldo.

Kjør `npm run check --workspace @samvev/web`, `npm run test --workspace @samvev/web` og den beviste web-builden gjennom review-rutinen. Følg faktisk registrerte scripts. Legg bare til meningsfulle tester for den endrede atferden: compose-inngang/rettighet, preview og tilgang til resten, samt eventuelle nye presentasjonsformuleringer. Ikke skriv tester som bare gjentar CSS-verdier.

Nettleser-QA skal kontrollere riktig mål og resultat ved åpning, ikke bare om en knapp finnes. Mål hele kontrollens rektangel mot synlig viewport i Shelly-fixturen; et synlig tekstfragment er ikke nok. Bruk isolert syntetisk database for innsending og datamengdevarianter. Kjør relevante M3-regresjoner, Axe, faktisk kontrast, zoom og fallback på endrede flater, samt repoets påkrevde etterreview/full retest/release-gate. Ikke gjenta brede tester utover påkrevd gate eller konkret endret risiko.

Åpne kandidatbildene faktisk, også tom og rik lys mobil. Gjenta implementering dersom et av de konkrete funnene fortsatt er synlig. Ikke stopp etter at en automatisk geometritest har blitt grønn.

## Capture, rapport og publisering

Bruk prosjektets etablerte område og Compose-prosjekt, ikke host-global konfigurasjon eller andre apper. Lag DCO-signert source-checkpoint i `.local/design-review-publish`, og synkroniser tillatte QA-inputs byte-identisk uten å skrive til beskyttet hoved-`.git`. Følg review-README:

```bash
bash scripts/design-review-runtime.sh
bash scripts/design-review-build.sh
# Målrettet nettleser-QA på denne kandidaten.
bash scripts/design-review.sh
```

Rutinenes låser, provenance og databevarende avgrensninger gjelder. Source, runtime, byggebevis, serverte assets og manifest skal samsvare. Ingen rebuild etter endelig capture uten ny nødvendig QA/capture. Dette er avgrenset QA-forberedelse, ikke produksjonsdeploy.

Regenerer og åpne alle 14 ordinære latest-bilder med eksakte navn over. Arkiver det forrige gyldige settet, og kontroller source SHA, round ID, viewport, tema, dimensjoner og SHA-256. Bruk viewportbilder som hovedgrunnlag og full-page som supplement.

Publiser et avgrenset `docs/design/review/round-7/`-sett med manifest for kilde/tema/viewport/datatilstand:

- Rik Home på alle fem viewporter i begge temaer, samt faktisk paired display på 1920 i begge temaer.
- Åpen «Ny beskjed» fra lys mobil med syntetisk innhold; behold også vanlig Home før åpning. Kontroller tomtilstand gjennom ordinær latest og målrettet QA.
- AI-oversikt på desktop/mobil i begge temaer med de eksisterende syntetiske kjente/ukjente tilstandene hvis etikettene endres.
- Persondetaljer trenger regresjonskontroll etter materialendringene; regenerer de fire etablerte personbildene hvis deres utseende påvirkes. Ikke produser mange nye like skjermbilder eller gjenta uendrede OAuth-oppsettbilder som bevis på nye funksjoner.

Supplerende data skal fortsatt ligge isolert fra LAN. Merk eventuell injisert transport eksplisitt. Ingen screenshots skal inneholde ekte kontoopplysninger eller framstilles som live ChatGPT-verifikasjon. Behold latest-kontrakten med 14 ordinære bilder.

Skriv `docs/design/review/ROUND_7_REPORT.md` og oppdater prosjektstatus der repoet krever det. Oppgi endrede filer, hvilke runde-6-restfunn som faktisk er lukket, visuelle før/etter-observasjoner, tester, eventuelle gjenværende gap og databevarende rollback. Ingen migrasjon forventes. Live samtykke/tilgang er fortsatt en egen, uverifisert brukerhandling og skal ikke blokkeres inn som et nytt krav for å avslutte UI-runden. Behold QA-tjenestene healthy og kontroller `admin/admin` uten passordendring.

Commit med DCO-signoff og push kun featurebranchen:

```bash
git push origin feat/m3-family-hub
```

Rapporter source SHA, review SHA, round ID og lenker. Ingen PR, merge, deploy, main-push, force-push, tag, release eller Actions-dispatch. Ikke skriv egen designgodkjenning i mailboxen; Work gjør neste review av publisert evidence.
