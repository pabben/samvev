# Samvev M3 – designrunde 1: komposisjon og høy referanseparitet

Denne filen er en passiv mailbox. Utfør oppgaven først når brukeren ber Codex om å lese og utføre den. Når den er aktivert, arbeid autonomt gjennom implementering, visuell iterasjon, kontroll, screenshots og featurebranch-push.

## Utgangspunkt og mandat

- Repository: pabben/samvev
- Branch: feat/m3-family-hub
- Verifisert branch-head før denne mailbox-endringen: 3a0d3954e41a1e2e84a573ee64de5d6fa939aefd.
- Vurdert UI/source SHA: 390f6a6a6027e257a5250cfed1cc0517b6974bd3.
- Reviewrunde: 20260929230125-390f6a6a-76ac151b, tatt 2026-09-29T23:01:25.756Z.
- Manifestet oppgir workingTreeDirty=true. Skill mellom oppgitt source SHA, faktisk kjørende QA-build og senere artefakt-/mailbox-commit.
- Work har visuelt inspisert begge originalreferansene og alle 14 bilder nedenfor. Samlet vurdering: 4/10 i designparitet. Designet er ikke visuelt godkjent.
- Work er design lead/reviewer. Du er implementatør. Ikke åpne PR, merge, deploye, tagge, publisere release, pushe main eller omskrive delt historikk.

Arbeid bare i /home/administrator/apper/samvev og med prosjektets isolerte samvev-m1 QA-ressurser. Les AGENTS.md og relevante produkt-/M3-instruksjoner, og følg prosjektets agentroller. Hent featurebranch og kontroller arbeidskopien. Bevar andres/uvedkommende endringer; ikke reset eller force-push. Ny mailbox-commit er forventet. Hvis nyere produktkode finnes, avklar differansen selv mot reviewgrunnlaget før du anvender funnene.

## Visuell fasit og gjennomgåtte bilder

Les først docs/design/review/README.md og latest/manifest.json.

Autoritative referanser:
1. docs/design/ChatGPT Image 24. sep. 2026, 23_51_09.png
2. docs/design/ChatGPT Image 24. sep. 2026, 23_52_06 (4).png

Disse overstyrer eldre mockups og SVG-referanser. Åpne og se på dem selv. Sammenlign UI-flaten inne i skjermene; fysisk kjøkken, apparatrammer og markedsføringstekst rundt skjermene skal ikke kopieres inn i appen. Produktnavnet er Samvev.

Alle følgende filer i docs/design/review/latest/ er vurdert:

| Viewport | Lys | Mørk |
|---|---|---|
| Desktop 1920×1080 | desktop-1920-light.png | desktop-1920-dark.png |
| Mobil 390×844 | mobile-light.png | mobile-dark.png |
| iPad stående 820×1180 | ipad-portrait-light.png | ipad-portrait-dark.png |
| iPad liggende 1180×820 | ipad-landscape-light.png | ipad-landscape-dark.png |
| Shelly-størrelse 1280×752 | shelly-1280-light.png | shelly-1280-dark.png |

Supplementer: desktop-1920-light-full.png, desktop-1920-dark-full.png, mobile-light-full.png, mobile-dark-full.png. Desktop full-page er 1920×1676 og mobil full-page 390×3055. Viewport-bildene avgjør hva som faktisk er synlig først. Alle bildene viser member Home, ikke paret display eller sertifisert fysisk Shelly-visning.

## Prioritert review og endringer

### P0.1 – Bygg om komposisjonen

I desktopbildene starter personkortene først rundt y=810. Den store administrative sidemenyen, toppbaren, introduksjonen og et eget stort påminnelsespanel dominerer. Familien, dagens aktiviteter og kommunikasjonen må bli hovedinnholdet.

- Erstatt Home-sidens brede permanente administrasjonssidefelt med kompakt navigasjon/top-bar. Behold alle eksisterende navigasjonsmål, konto-/innstillingsadgang og forståelige etiketter.
- Samle dato, klokke og en kort hilsen i ett toppområde. Fjern gjentakelsen av dato og husstandsnavn. Gjør demo-merking og normal tilkoblingsstatus kompakte, fortsatt tilgjengelige og sanne.
- Behold viktig innhold synlig, men reduser tomrom og dobbel kortinnpakking i Action Board.
- Lys desktop: fire store personområder ved siden av dagsplanen, omtrent 65–70 % / 30–35 % av hovedraden for denne firepersoners-fixturen. Under: en tydelig familiemelding og mindre støttewidgets i et balansert grid.
- Mørk desktop: fire tydelige hovedområder i referansens rytme: I dag, I morgen, Familien og Verdt å huske. I dag og I morgen skal være selvstendige naboflater med reell visuell tyngde. Under: bred familiemelding og et mindre område for eksisterende oppsummering/liste.
- Bruk felles datakilder, komponenter og handlinger. Temaspesifikk desktop-komposisjon er tilsiktet fordi fasitene har ulik struktur. Ikke dupliser interaktive elementer eller lag to separate produktimplementasjoner.

### P0.2 – Gi hver skjermstørrelse en fungerende førsteside

Mobilens første viewport inneholder nå hero og to påminnelser, uten navngitte personkort, agenda eller familiemelding. På Shelly starter seksjonsoverskriftene først omkring y=700; personer og aktiviteter er praktisk talt under skjermen. iPad landscape har samme problem. Portrait mister omtrent 190 px til sidefeltet og viser ikke agenda i første viewport.

- Mobil: kompakt merke/hilsen, navngitt familieidentitet, korte viktige påminnelser, tidlig agenda og familiemelding. De fire fulle personkortene skal ikke være en obligatorisk lang kø før agendaen. Behold tilgang til alle personenes innhold.
- Bruk korte forhåndsvisninger med tydelig åpning til eksisterende fulle detaljer. Ikke skjul kritiske påminnelser bak karusell, fane eller «Mer».
- iPad portrait: bruk bredden til familien og dagens innhold, med balansert tokolonners innhold der det er lesbart. Ingen bred, tom sidemeny.
- iPad landscape og 1280×752: egen komposisjon tilpasset begrenset høyde, med kompakt topp og synlig hovedinnhold. Dette må ikke løses med zoom, transform:scale eller mindre skrift.
- Behold mobil bunnavigasjon og nødvendig safe-area/plass under innhold. Full-page-bildenes navigasjon over innhold ved original viewport-grense er et dokumentert capture-fenomen; ikke behandle det som bekreftet runtime-feil uten interaksjonskontroll.

### P0.3 – Gjenskap materialet, særlig mørkt glass

Dagens mørke modus har navy-grunn, men store blågrå, brune og lilla flater oppleves opake. Referansen har svart/navy dybde, bakgrunnslys og tydelig lagdeling.

- Mørkt: dypere grunnflate, rolig landskaps-/lysdybde i topp/bakgrunn, gjennomskinnelige tonale paneler, diskret lyskant og kontrollert skygge. Bakgrunnen skal oppleves gjennom materialet uten å forstyrre tekst.
- Lys: varm elfenbensflate, lette glass-/hvite kort, klarere blå/rosa/mint/lavendel-personfarger og et mildt organisk bakgrunnspreg. Bevar familiestemning og letthet.
- Erstatt den dominerende abstrakte bølgeheroen med et mindre, integrert bakgrunnsuttrykk nærmere referansene.
- Bruk egnede eksisterende/lokale dekorative assets når tilgjengelig; ingen eksterne bildeforespørsler i QA. Ikke bruk hele referansebildet som appbakgrunn, og ikke la et dekorativt foto bli en ny stor innholdsblokk.
- Sørg for lesbar fallback uten backdrop-filter. Ikke reduser tekstkontrast for å få «glass».

### P1.1 – Styrk personidentitet og kortproporsjoner

Små initialer i brede fargebånd gir et registerpreg. På mobil har fire kort mye tom høyde for én eller to linjer innhold.

- Lys desktop: tydelig større avatar/initialalternativ, navn som hovedtekst og synlig personfarge. Avatar og personinnhold skal bære kortet, slik referansen gjør.
- Bruk faktiske personbilder hvis datamodellen allerede støtter dem; ellers et gjennomarbeidet initialalternativ. Ingen hardkodede ansikter, navn eller nye avatar-/opplastingssystemer.
- Mørk familieflate: gjenkjennbare personer med navn, avatar/fallback og relevante eksisterende punkter i en rolig, tydelig gruppe.
- La korthøyde og innholdsrytme følge den faktiske mengden; bevar balanserte rader uten store tomme felt.
- Samme person skal ha konsekvent farge mellom avatar, kort og tema. I dagens screenshots samsvarer hero-initialenes farger ikke tydelig med personkortenes farger.
- Ikke fabrikkér XP, fremdrift eller fullført-status for å etterligne referansen.

### P1.2 – Løft familiekommunikasjon og balanser støtteinnhold

«Rundt familiebordet» ligger nesten sist: etter tre sekundære oppsummeringskort. Desktop har dessuten et stort tomt område under agendaen ved siden av støttewidgets.

- Flytt ekte familiemeldinger inn i hovedkomposisjonen før sekundære oppsummeringer, og gi avsender og selve budskapet visuell verdi.
- Bruk tydelig avsenderidentitet, myk meldingsoverflate og diskret tidspunkt. Unngå at området bare ser ut som en lang administrativ rad.
- Fordel eksisterende summary/list cards som mindre støttewidgets. Unngå både stort tomt høyrefelt og tre like tunge tekstbokser.
- Behold betydningsskillet mellom menneskeskrevne meldinger, AI-avledet oppsummering, påminnelse og strukturert liste, med kildeinformasjon tilgjengelig.

### P1.3 – Gjør dagsplan og tidshierarki tydelig

- I dag / I morgen må ha tydelige overskrifter, lett skannbare tider og en diskret timeline/rytmisk radstruktur. Tomtilstander skal være ærlige og kompakte.
- Ikke fyll tom «I morgen» med oppdiktede hendelser for å matche referansen.
- Kontroller den synlige inkonsistensen der personkort er merket «Kommende», men viser tirsdagspunkter mens headeren viser onsdag. Verifiser startsAt, tidssone og innholdstype før eventuell målrettet retting. Ikke omdater eller slett QA-data for å pynte på bildet.
- Vurder visuell forbedring uavhengig av naturlige innholdsendringer over midnatt.

### P2 – Typografi, ikonografi og finish

- Tydelig skala mellom hilsen, seksjon, personnavn, aktivitet og metadata. Mye ubrukt flate kombinert med liten innholdstekst skal bort.
- Mindre vekt på versaler, teknisk status og gjentatte metadata. Bevar kilde/proveniens i tilgjengelig detaljvisning.
- Bruk konsekvent ikonfamilie, optisk balanserte størrelser og kontrollert farge. Mer personlighet gjennom personer og innhold, ikke tilfeldig emoji-dekor.
- Samordne spacing, radius, border og skygge. Hovedpanel, innholdskort og små labels skal ha forskjellig visuell vekt.
- Bevar Samvev-identitet også på mobil, der dagens viewport bare har «Hjem» som topptekst.

## Responsiv og tilgjengelig akseptanse

Vurder ved 100 % zoom med den eksisterende syntetiske datamengden. Høydemål er komposisjonsbudsjett, ikke clipping-regler.

| Størrelse | Krav til ferdig førsteside |
|---|---|
| 1920×1080 lys | Hovedraden starter senest omtrent y=280. Alle fire personområder med faktisk innhold, dagsplan og minst én ekte familiemelding er synlige uten scroll. |
| 1920×1080 mørk | I dag og I morgen er tydelige nabopaneler i hovedraden, sammen med familie og viktige påminnelser. Ekte familiemelding er synlig uten scroll. |
| 390×844 begge | Over bunnavigasjonen: Samvev-identitet, navngitte personer i kompakt form, eksisterende viktige påminnelser og minst én hel agenda-/tomtilstandsrad. Familiemelding følger før fulle personlister og sekundære oppsummeringer. |
| 820×1180 begge | Ingen bred administrativ sidebar. Alle fire personers identitet og minst én agenda-/tomtilstandsrad er synlige i første viewport. |
| 1180×820 og 1280×752 begge | Nyttig hovedinnhold starter senest omtrent y=220. Faktisk personinnhold og minst én komplett agenda-/tomtilstandsrad er synlig uten scroll; høyde brukes på innhold fremfor hero. |

- Bevar samme innhold og tilgjengelige handlinger ved temabytte, rotasjon og resizing.
- Støtt eksisterende 1/4/8-personstilfeller, lange navn, lange tekster og tomme seksjoner uten horisontal side-overflow.
- Ikke bruk fontkrymping som løsning: normal innholdstekst omtrent 16 px eller større, og lesbar metadata.
- WCAG AA: minst 4,5:1 normal tekst, 3:1 stor tekst og relevante kontroll-/fokusgrenser. Test de faktiske kompositerte glassflatene.
- Sikre tastatur, tydelig fokus, semantiske overskrifter, forståelige knappenavn, dialogfokus og fokusretur. Visuell rekkefølge og lese-/fokusrekkefølge må stemme også i temaspesifikke grid.
- Trykkflater minst 44×44 CSS-px, reduced-motion-støtte og ingen farge som eneste bærer av status eller personidentitet.
- Ingen uløselig overlapping med fast navigasjon, ingen skjult kritisk informasjon og ingen «alt i karusell»-løsning.

## Bevar produktet og avgrens arbeidet

Behold Samvev-navn/logo, eksisterende ruter og fungerende handlinger, dynamiske personer/mottakere, NB/EN, light/dark/system, husholdningstidssone, startsAt-basert dagsdeling, SSE, utløp/offline-regler, tillatelser for barn/display, personvern og render acknowledgments. AI Oppdrag forblir sekundært under Mer.

Ingen nye backend-API-er, migrasjoner, integrasjoner, smarthjemkontroller, værdata, belønningssystemer eller AI-funksjoner i denne runden. Ikke kopier eksempeldata fra referansene. Ingen ekte familie-/barnedata. Bevar review-rutinens isolasjon, arkivering og failure-safeguards; ikke endre tester bare for å få grønne resultater.

## Arbeidsmåte og kontroll

1. Åpne begge referansene og alle baseline-bildene. Lag en kort konkret komposisjonsplan for lys, mørk og liten skjerm, og gjennomfør den uten å vente på en ny godkjenning av ordinære designvalg.
2. Gjør P0-komposisjonen først, deretter P1 og P2. Se faktiske lokale screenshots etter hver vesentlige runde. Fortsett til kriteriene for denne runden er oppfylt; ikke stopp etter én CSS-justering.
3. Kjør målrettet i eksisterende prosjektmiljø med Node 24:
   - npm run check --workspace @samvev/web
   - npm run test --workspace @samvev/web
   - npm run build --workspace @samvev/web
   - node --test scripts/design-review-publication.test.mjs
4. Kjør én samlet eksisterende M3 browser-regresjon etter hovedendringene, med apps/web/tests/m3-family-hub.mjs i isolert samvev-m1 qa-browser. Les harness og dokumentert kommando først: den endrer syntetiske QA-fixtures og display-tilkoblinger. Bevar baseline/arkiv og bruk den ikke som gjentatt capture-snarvei. Kontroller NB/EN, begge temaer/system, fokus, kontrast, 1/4/8 personer, lange tekster, dialogs og eksisterende sanntids-/display-regresjoner.
5. Ikke kjør den brede reset-rutinen bash scripts/m1.sh qa-test eller sammenlign mot utdaterte M1-baselines. Ikke dispatch GitHub Actions. Utvid testing bare ved konkret regresjonsrisiko eller pålagt repo-gate.
6. Commit UI-koden med DCO-signoff som et identifiserbart source-checkpoint. Sørg deretter for at kun nødvendige isolerte QA-tjenester bygger/kjører den versjonen, uten å slette QA-volumer. Dokumenter hvordan kjørende app/bundle er koblet til checkpointet. En ny HEAD alene beviser ikke hvilken UI som kjører.
7. Kjør nøyaktig: bash scripts/design-review.sh
8. Åpne alle 14 nye bilder faktisk. Sammenlign viewport mot riktig original og forrige runde; bruk full-page bare som supplement. Kontroller manifestets source SHA, tidspunkt, tema, dimensjoner og filhash. Source SHA skal være ny. Ikke kamufler dirty-tree-status; dokumenter eventuelle uvedkommende endringer uten å inkludere dem.
9. Hvis bilder avdekker tydelige gjenværende feil, rett dem, lag nytt UI-checkpoint og regenerer. Ikke erklær visuell paritet ut fra test-PASS.
10. La review-rutinen arkivere forrige gyldige runde. Commit bare relevante kilde-/test-/dokumentasjonsfiler og komplett validert review-sett med DCO. Push eksplisitt kun: git push origin feat/m3-family-hub

Regenerer alle ti viewport-bilder og alle fire full-page-bilder med nøyaktig filnavnene ovenfor. Behold manifest og bilder samlet. Bruk lokal QA, ingen ekstern deploy.

## Sluttleveranse

Rapporter kort:
- Nye source- og review-commit-SHA-er og roundId.
- Lenke til branchens latest/manifest.json.
- Hvilke P0/P1/P2-punkter som faktisk er løst, og eventuelle konkrete restavvik.
- Testresultater og visuell vurdering separat for lys desktop, mørk desktop, mobil, iPad og 1280×752.
- Endrede filer og eventuell forskjell i syntetisk datagrunnlag/tidspunkt.
- Bekreft at ingen PR, merge, deploy, main-push eller uvedkommende endringer er gjort.

Målet er at originalreferanse og implementasjon side om side oppleves som samme design. En moderne app med omtrent riktige farger er ikke nok.
