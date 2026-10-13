# Samvev – revidert runde 8: samme design på alle sider, seks personer og offentlig testversjon

Dette er Pabbens samlede, reviderte bestilling til den allerede pågående runde 8. Ta den inn i samme Codex-økt og viderefør utført arbeid. Ikke start en konkurrerende implementering, forkast arbeid eller reset til en eldre commit. Gjennomfør implementering, visuell iterasjon, tester, review-evidence og den uttrykkelig autoriserte testpubliseringen. Ikke stopp ved en plan eller første CSS-justering. Work er designreviewer; server-Codex implementerer og publiserer.

## Ny produktretning – overstyrer forrige runde-8-bestilling

Pabben har sett siden selv og opplever at Home har et design som ikke videreføres på de andre sidene. Han har gitt tre konkrete føringer:

1. Designet skal gjelde hele Samvev, ikke bare Home. Originalreferansene er fortsatt visuell fasit; det holder ikke med omtrent samme stil eller en vurdering på 8/10.
2. Neste hovedtest skal ha **seks personer: to voksne og fire barn**. Dette erstatter fem personer som primærfixture. Fire/fem personer beholdes som regresjon, åtte som stress.
3. **Publisering til `https://samvev.pabben.org/` er uttrykkelig autorisert.** Nettstedet er ikke i aktiv bruk og skal nå brukes som testversjon. Denne instruksen overstyrer tidligere deployforbud for akkurat Samvev på dette domenet, også eldre generelle formuleringer i prosjektinstruksene. Ingen ny generell deploybekreftelse trengs.

Andre rammer gjelder fortsatt: arbeid/push på featurebranch, ingen PR, merge, main-push, force-push, tag, release eller Actions-dispatch. Ikke endre andre apper eller global server-/proxykonfigurasjon. Work endrer bare denne mailboxen; server-Codex gjør implementering og testdeploy.

## Branch, vurdert kilde og arbeidsmåte

- Repository: `pabben/samvev`.
- Arbeidsbranch: `feat/m3-family-hub`.
- Sist visuelt vurderte review SHA: `64bb5896d8b0c2684ba7ec4cd1e2b439fcc5f99b`.
- Vurdert UI/source SHA: `f65d75f55cdf3ed0a7fd2915e97d045923c6e35c`.
- Round ID: `20261013194236-f65d75f5-ba8caa81`.
- Forrige runde-8-mailbox: `eba91fafd6ee22186b6cbb636144ea3eb487f9cd`; denne teksten erstatter den.
- Tidligere visuell baseline: runde 6, source `158d9e33949715403998b914d2180d95b66e9ae3`, review `094624f8af6449870fc5f253f128f5df928e3fac`.

Mailbox-commits endrer ikke hvilken kilde screenshotene viser. Hent siste featurebranch gjennom etablert `.local/design-review-publish`; bevar nyere arbeid og beskyttet hoved-`.git`. Hvis runde-8-endringer allerede finnes lokalt eller er pushet, integrer bestillingen i dem og oppgi faktisk ny kilde i rapporten. Ikke overfør eldre QA-bevis til en endret kandidat.

Les `AGENTS.md`, relevante produktkrav/ADR-er, `docs/design/review/README.md`, `latest/manifest.json`, `round-7/manifest.json`, `ROUND_7_REPORT.md`, `round-7/validation.json`, denne prompten og relevante deler av `docs/implementation/M1_OPERATIONS.md` og `M1_RESTORE_GATE.md`. Følg repoets definerte agentarbeidsflyt, én skrivende agent om gangen, etterreview, komplett retest og release-gate. Ny brukerautorisasjon gir adgang til den avgrensede testdeployen; eldre «ingen deploy»-tekst skal ikke stoppe den.

## Hva Work faktisk har kontrollert

Work har åpnet begge originalreferansene, alle 14 ordinære og 21 supplerende runde-7-screenshots, to avledede sammenligningsbilder og relevante runde-6-bilder. Alle 35 nye bildehasher og dimensjoner er kontrollert. Manifestenes source SHA og oppgitte input-/root-/clone-fingeravtrykk samsvarer. Serverens 272/272 tester er rapporterte resultater, ikke tester Work har kjørt på nytt.

Runde 7 forbedret lys mobil med «Ny beskjed», prioritering av mørke påminnelser, iPad portrait-bredde, komplette Shelly-kontroller, AI-oversiktens tall/språk, roligere lys bakgrunn og dempet mørk forgrunn. Bevar disse resultatene. Persondetaljer og fjernet merkevarefooter skal også bevares.

Det nye helhetsbruddet er visuelt bekreftet mellom Home og AI: navigasjon og innramming skifter. Koden underbygger brukerens observasjon: `member.tsx` gir bare `tab === "home"` klassen `home-shell`; øvrige medlemssider faller tilbake til den eldre sidebaren/topbaren. Work har visuelt vurdert Home, AI, persondetaljer og composer. Øvrige flater er kartlagt i kode, men skal åpnes faktisk av Codex før de omtales som visuelt kontrollert.

Ingen ny P0 er påvist i det vurderte bildesettet. De to P1-områdene nedenfor er reelle produkt-/designgap. Vi erklærer ikke endelig designgodkjenning eller «nær identisk» på grunnlag av grønne tester. Live ChatGPT-samtykke, kontotilgang og faktisk belastning er fortsatt uverifisert; nye live AI-kall er ikke bestilt.

## Autoritative referanser og baselinebilder

Åpne de faktiske PNG-filene:

- `docs/design/ChatGPT Image 24. sep. 2026, 23_51_09.png`
- `docs/design/ChatGPT Image 24. sep. 2026, 23_52_06 (4).png`

De overstyrer eldre SVG-er/mockups. Sammenlign selve appflatene, uten rom, skjermrammer og collage. Navnet er **Samvev**, selv om referansene viser FamilieOS. Ikke hardkod navn, eksempeldata eller tekster fra referansene. Footer med Samvev og slagord skal fortsatt være fjernet. Nødvendig displayinformasjon om deling/oppdatering beholdes.

De 14 vurderte ordinære bildene ligger i `docs/design/review/latest/`:

| Viewport | Lys | Mørk |
|---|---|---|
| 1920×1080 | desktop-1920-light.png | desktop-1920-dark.png |
| 390×844 | mobile-light.png | mobile-dark.png |
| 820×1180 | ipad-portrait-light.png | ipad-portrait-dark.png |
| 1180×820 | ipad-landscape-light.png | ipad-landscape-dark.png |
| 1280×752 | shelly-1280-light.png | shelly-1280-dark.png |

Full-page-supplement: `desktop-1920-light-full.png`, `desktop-1920-dark-full.png`, `mobile-light-full.png`, `mobile-dark-full.png`.

Vurdert supplement i `docs/design/review/round-7/`: de ti viewportfilene fra tabellen i rik isolert tilstand; `display-1920-light.png`, `display-1920-dark.png`; `person-desktop-light.png`, `person-desktop-dark.png`, `person-mobile-light.png`, `person-mobile-dark.png`; `ai-overview-desktop-light.png`, `ai-overview-desktop-dark.png`, `ai-overview-mobile-light.png`, `ai-overview-mobile-dark.png`; `compose-mobile-light.png`. De avledede sammenligningsarkene i `round-7/comparisons/` erstatter ikke originaler/viewportbilder.

Datatilstandene varierer: ordinær LAN-baseline har fem bevarte personer og naturlig tomme dager; runde-7-fixturen har fire personer og rikere innhold. Ikke framstill forskjellig innhold som en kode-regresjon. Den nye seks-personers-fixturen skal være tydelig identifisert og isolert fra bevarte data.

## P1-A – ett sammenhengende design gjennom hele produktet

Start med å åpne alle eksisterende brukerflater på samme kjørende kandidat, i lys og mørk modus. Kartlegg overgangen fra Home, så konkretiser felles appskall og komponenter før sidene tilpasses. Ikke bare legg `home-shell` på alle sider: Home-spesifikke skjuleregler, grid og størrelser skal skilles fra det delte appskallet.

Dette er faktisk navigasjon/state, ikke nye URL-ruter som skal bygges:

| Brukerflate | Eksisterende inngang/state | Design- og funksjonskrav |
|---|---|---|
| Hjem | `home` | Behold hovedkomposisjon/persondetaljer og forbedre seks-personers-layouten. |
| Beskjeder | `messages`, Nå/Planlagt/Historikk | Menneskelig meldingsflate med gjenkjennelig avsender, innhold, mottakere/status og tydelig skrivehandling. |
| Personer | `people` | Samme personidentitet, avatarer og farger som Home; lett å finne detaljer og eksisterende redigering. |
| Mer | `more` | Ryddige innganger til eksisterende støttefunksjoner i samme appinnramming. |
| Skjermer | `displays` via Mer | Lesbare status-/oppsettkort, paring og eksisterende tillatelser. |
| Integrasjoner | `integrations` via Mer | Samme materialer og kontrollhierarki; avanserte detaljer sekundært. |
| Oppdrag | `monitors` via Mer | Eksisterende overvåking/status/resultat/kilder i rolig, lesbar komposisjon. |
| AI og forbruk | `ai` via Mer, Forbruk/Tilkobling-oppsett | Behold korrekte tall, kostnadsforbehold og funksjoner; tilpass skall/materialer. |
| Dine innstillinger | Kontoikon/dialog | Samme typografi, kontroller, fokus og dialogmateriale. |

Ta også med persondetaljer, fulle meldings-/påminnelsesvisninger, ny/rediger beskjed, planlegging/mottakere, relevante bekreftelser og eksisterende redigeringsdialoger. Innlogging og `/invitation` skal bruke samme merkevare/materialspråk i et enkelt uinnlogget skall. Førstegangsoppsett prøves bare isolert, uten å nullstille en claimed installasjon. Faktisk paired `/display` beholder sin hensikt og sine rettigheter. Intern `/workbench` er ikke en ny slutbrukerflate som skal redesignes.

Konkrete endringer:

- Et vedvarende appskall: samme plassering av merkevare, primærnavigasjon, konto-/temainngang og mobil bunnavigasjon når man skifter medlemsside. Behold Home-innholdets grid separat fra skallet. Underflater skal ha tydelig sidetittel/kontekst og retur uten å bytte navigasjonsmodell.
- «Mer» skal markeres som overordnet aktiv navigasjon også når Skjermer, Integrasjoner, Oppdrag eller AI er åpne. Bevar tastatur-/skjermleserorientering og state ved lovlige navigasjonsskifter.
- Del bakgrunn, kort-/dialogmaterialer, innvendige flater, radius, kanter, skygger, ikonvekt, typografihierarki, spacing, knapper, inputfelt og fokusmarkeringer. Bruk eksisterende tokens/komponenter der de passer; unngå et tredje parallelt designsystem. Det skal synes i selve innholdskomponentene, ikke bare i bakgrunnen.
- Lys modus viderefører referansens varme familiepreg, blå/mint/pastell og tydelige personfarger. Mørk modus viderefører dyp navy, lagdelt rolig glass og lesbare flater. Home er et implementert utgangspunkt; originalbildene er fortsatt fasiten.
- Tilpass komposisjonen til hver oppgave. Meldinger og personer skal føles menneskelige. Oppsett/status trenger passende lesebredde og tydelig primærhandling, ikke Home-kortenes store minimumshøyder. Ikke fyll skjemaer med dekorative tomflater.
- Bruk samme valgte avatar og stabile personfarge der samme person vises. Meldingstavlens personstabel og avsenderavatarer bruker i dag ikke valgt `avatarKey` alle steder. Koble eksisterende tillatte data med person-ID; ikke gjett fra navn eller utvid datatilgang. Et kompakt «+N» kan brukes i en sekundær avsender-/deltakerstabel, men Home skal ikke skjule familiemedlemmer bak det.
- Tomtilstander, loading, feil og dialoger skal høre til samme produkt. Ikke svekk lesbarhet eller kontrast for mer gjennomsiktighet. Ingen nye funksjoner, ny routing, backendarkitektur eller generell auth-ombygging er bestilt.

## P1-B – seks personer er normaltilstanden, ikke et stresstilfelle

Primærfixture: **seks syntetiske personer, to voksne og fire barn**, med eksisterende alders-/personmodell, tydelige ulike identiteter og realistisk tillatt innhold. Bruk tydelig syntetiske navn, avatarer og aldersdata. Ikke bruk familiens virkelige personopplysninger eller framstill testdata som virkelige. Alder og rolle er ikke det samme: ikke gi seks personer adminrettigheter eller gjøre nye antakelser om barns capabilities. Behold serverens tilgangsmodell.

Lag fixturen i en isolert syntetisk testdatabase/eksisterende egnet QA-harness. Ikke endre, slette, reseede eller redatere de fem personene og dataene i ordinær LAN-QA for å få pene screenshots. Offentlig eksisterende data bevares også. Hvis en egen offentlig testhusstand må brukes, skal den være separat, syntetisk og opprettes gjennom etablerte autoriserte mekanismer.

Runde-7-funnet som skal løses er konkret: lys storflate bruker fire kolonner og høye minimumskort. Femte person havner alene i en ekstra høy rad, dagsplanen strekkes med raden, og støtte-/meldingsinnhold faller under første viewport. Desktop full-page er 1920×1490 selv med lite innhold. Seks personer må heller ikke arve fire høye kort pluss en ubalansert rest-rad.

- Komponer personområdet etter faktisk antall personer og tilgjengelig panelbredde. På 1920×1080: sammenlign seks lesbare kort på én rad med en balansert kompakt 3×2-gruppe; velg løsningen som best bevarer originalens tydelige personområder og helhet. Ikke bind løsningen til navn, fixture-ID eller bare ett persontall.
- På 1180×820 og 1280×752 skal seks personer få en samlet, balansert gruppe med meningsfull kortstørrelse. Ikke la dagsplanen arve flere tomme minimumshøyder når persongruppen får to rader. Behold store tydelige identiteter og rolig spacing; ikke krymp all tekst.
- I den avgrensede rike seks-personers-fixturen skal alle seks identiteter/personinnganger, tre korte hendelser i dag, inngang til i morgen/påminnelser og en menneskelig melding med avsender være tilgjengelige og synlige i første viewport på disse tre brede størrelsene. Nødvendige knapper skal være helt synlige. Fullt detaljinnhold kan bruke eksisterende oppsummeringer og person-/samlevisninger.
- På mobil og iPad portrait: prioriter dagens plan og klare familieinnganger. Bevar mobilens «Ny beskjed», neste hendelse i lys modus og tre komplette korte dagsplanrader over bunnavigasjonen i mørk modus i den avgrensede fixturen. Bruk en kompakt, lesbar familieoversikt og naturlig reflow. Det kreves ikke seks fullstendige personkort over bretten på mobil. Alle seks skal kunne finnes og åpnes uten skjulte horisontale hovedområder.
- På iPad portrait skal både påminnelsesinngang og familiemelding med avsender fortsatt ha god prioritet; bevar de etablerte førsteskjermmålene i den korte fixturen. På faktisk paired display behold riktig informasjonsutvalg og fravær av medlemmenes skrivekontroller.
- Gi hver person en stabil, gjenkjennelig identitet også når antallet overstiger fire. Gjeldende eksplisitte avatar-/fargevalg beholdes. Initial-fallback er gyldig når illustrasjon ikke er valgt; ikke endre data for kosmetikk.
- Kontroller 4→5→6 og åtte personer. Den tomme fempersoners LAN-tilstanden skal også få bedre balanse. Lange navn, mer innhold, åtte personer, små skjermer og ekte 200 % zoom kan scrolle naturlig. Ikke innfør global `overflow:hidden`, faste klippehøyder eller en karusell som skjuler personer for å bestå et screenshot.

## P2-C – avgrenset materialeprøve og sammenhengende detaljer

Bevar runde-7-forbedringene i bakgrunn/materialer. Mørk original viser en fjellrygg bak hilsenen og en smal varm horisont nær kortenes overkant. Dagens brede Home viser mer himmel der, med fjellene mer bak panelene. Originalen har også mer lokal blålig refleksjon øverst i høyre paneler.

Prøv et moderat høyere utsnitt av eksisterende landskapsressurs på bred mørk Home/display og eventuelt svak lokal lysvariasjon øverst i høyre glassflater. Behold mørkt rolig tekstunderlag og dempet steinforgrunn. Åpne original, runde 7 og kandidat ved sammenlignbar appbredde. Behold forsøket bare hvis det faktisk øker referanselikheten uten uro eller dårligere lesbarhet; ellers behold runde-7-materialet og forklar hvorfor. Ingen ny art-asset eller generell «mer glass»-runde er nødvendig.

Samtidig finjusteres konsistente ikoner, avatarstørrelser, metadata, titler, indre spacing og fokus i de omarbeidede sidene. Ikke bruk denne poleringen til å utsette P1-helheten. Lys bakgrunn skal beholde den roligere retningen; ikke gjeninnfør store grønne flekker.

## Hva som skal bevares

- Samvev-navnet, fjernet merkevarefooter, valgte avatarer/farger og initial-fallback.
- Persondetaljer ved persontrykk; fulltekst, sted, tidsintervall, kildeopplysninger, riktig person/husstand og fokusretur.
- Skriveinnganger, preview-prioritering/tellinger, iPad-påminnelsesbredde, Shelly-kontroller og gyldige allerede forbedrede komposisjoner.
- AI-oversiktens korrekte tall/språk og eksisterende pris-/dispatch-/refresh-/companion-rettelser. Ingen ny AI-funksjon, automatisk betalt fallback eller live modellkall. Ikke hent eller kopier Codex-credentials.
- Autentisering, serverfiltrering, eier-/husstandsgrenser, begrensede/barnetilganger, display-grants, SSE, utløp og offline. Visuell konsistens gir ikke nye rettigheter.
- Ordinær LAN-QA og `admin/admin` der, eksisterende personer/data/passord/preferanser og beskyttet hoved-`.git`. Ingen reset/reprovisionering/reseed av eksisterende installasjoner.
- Ingen private data, tokens, aktive invitasjons-/paringskoder, kontoidentitet/saldo eller hemmeligheter i Git/screenshots/rapporter. Publisering bruker vanlig eksisterende tilgangsvern, som beskrevet nedenfor.

Ingen nye datamigrasjoner forventes for designarbeidet. Eventuelle allerede eksisterende kanoniske migrasjoner som en eldre offentlig installasjon trenger, håndteres gjennom etablert og verifisert oppgraderings-/restore-rutine. Ikke endre migrasjonshistorikk eller forfatte en ny migrasjon for et layoutbehov.

## Responsivitet, tilgjengelighet og funksjonell kontroll

Kontroller alle de fem etablerte viewportene i begge temaer. Gå faktisk mellom alle medlemssidene og relevante dialoger. Sidene skal beholde samme orientering, brand og materialer, med hensiktsmessig innholdsbredde på desktop og naturlig reflow på mobil/iPad/Shelly.

Minst 44×44 trykkflater, synlig fokus, semantiske knapper/lenker, tydelig aktiv navigasjon, riktig leserekkefølge og ingen nestede interaktive kontroller. Behold NB/EN, reduced-motion og safe areas. Åpne/lukk dialoger med tastatur, Escape og korrekt fokusretur; prøv resize og temaskifte mens persondetalj er åpen. Ingen tapt informasjon eller horisontal hovedoverflyt ved ekte 200 % nettleserzoom. Mål WCAG AA på de faktiske kompositerte flatene, også uten backdrop blur. Ikke baser kontrastpåstanden bare på tokenverdier.

Målrettede brukerreiser skal minst dekke:

- Home → detaljer for både voksne og barn, inkludert person fem og seks, og korrekt retur.
- Beskjeder → Nå/Planlagt/Historikk, ny beskjed, mottakere/planlegging, avbryt og tillatt publisering/tilbaketrekking av syntetisk testinnhold.
- Personer → eksisterende redigerings-/avatardialog, uten utilsiktet endring av bevarte data eller capabilities.
- Mer → Skjermer/Integrasjoner/Oppdrag/AI → tilbake, med korrekt aktiv navigasjon. Kontroller eksisterende status-/oppsett- og bekreftelsesflater uten å utløse live providerhandlinger for et designscreenshot.
- Konto → innstillinger, tema/locale og fokus; inn-/utlogging; relevante invitasjons-/oppsettilstander i isolert test.
- Faktisk paired display med seks personer og riktig tilgang/privacy/offline/utløp.

Bruk meningsfulle tester for delt navigasjon/appskall, seks-personers-geometri og faktisk brukerhandling. Ikke lag tester som bare gjentar et CSS-kolonneantall, fargenavn eller et nytt `min-height`-tall. Kontroller hele knapper/kort og synlighet, ikke bare DOM-antall. Behold eksisterende server-/rettighetstester.

Kjør `npm run check --workspace @samvev/web`, `npm run test --workspace @samvev/web`, den beviste web-builden og repoets påkrevde komplette retest, etterreview og release-gate. Bruk faktisk registrerte scripts. Kjør relevant M3-, Axe-, kontrast-, zoom- og fallback-QA for endret risiko. Ingen ny generell live OAuth-/betalingsgate.

## Akseptansekriterier for runden

1. Home, Beskjeder, Personer, Mer og alle eksisterende underflater oppleves som samme Samvev: navigasjonen skifter ikke mellom to ulike appskall, og kort, dialoger, skjemaer og typografi har samme designfamilie i begge temaer. Alle er faktisk åpnet.
2. Seks personer, to voksne og fire barn, er primær visuell fixture. Alle seks har tydelige personinnganger og korrekt detaljinnhold. Avgrensede førsteskjermmål på brede skjermer er oppfylt uten klipping, bortgjemte personer eller mikrotekst.
3. Mobil/iPad er samme produkt, med tilgjengelige handlinger og god innholdsprioritering. 4/5/8 personer, lange tekster, tomme/rike tilstander og 200 % zoom fungerer; naturlig scrolling ved større innhold er tillatt.
4. Rolle-/husstandsgrenser, display-grants, redigering, composer, persondetaljer og AI-tall har ingen regresjon. Eksisterende data og protected Git er bevart.
5. Originalene, runde 7 og kandidat er visuelt sammenlignet. Materialprøven er begrunnet beholdt/forkastet. Ingen påstand om nær-identisk design bare fordi tester består.
6. Den ferdige kandidaten er publisert på `https://samvev.pabben.org/` gjennom den eksisterende Samvev-spesifikke driftsveien, og faktisk HTTPS-/autentisert navigasjons-QA er utført. Offentlig runtime er knyttet til oppgitt source SHA; LAN-QA og offentlig testmiljø er tydelig skilt i bevisene.
7. Review-evidence og rapport beskriver faktisk gjennomført arbeid, kilde, datatilstand, tester og eventuelle konkrete restbegrensninger. Hvis ekte tilgangs-/driftsblokkering gjenstår, rapporteres den presist; ikke merk deploykravet bestått eller be om en generell tillatelse som allerede er gitt.

## Capture og review-evidence

Bruk etablert workspace og korrekt eksisterende QA Compose-prosjekt etter README. Ikke endre andre prosjekter eller host-global konfigurasjon. Lag DCO-signert source-checkpoint via `.local/design-review-publish`; tillatte QA-inputs skal være byte-identiske uten skriving til beskyttet hoved-`.git`. Følg låser, provenance og databevaring:

```bash
bash scripts/design-review-runtime.sh
bash scripts/design-review-build.sh
# Målrettet nettleser-QA av denne kandidaten.
bash scripts/design-review.sh
```

`bash scripts/design-review.sh` skal kjøres etter ferdige endringer. Den etablerte capture-kontrakten gjelder LAN-QA; ikke pek rutinen stille om til offentlig miljø eller framstill LAN-bilder som offentlige. Source, runtime, byggebevis, serverte assets og manifest skal samsvare. Endringer etter endelig capture krever ny nødvendig QA/capture. Offentlig utrulling bruker samme ferdige kilde, men sin egen korrekte driftskonfigurasjon.

Regenerer og åpne alle 14 ordinære latest-bilder med eksakte navn over. Bevar ordinære LAN-data; dette settet kan derfor fortsatt ha fem personer. Arkiver forrige gyldige sett byte-identisk. Verifiser source SHA, round ID, viewport, tema, dimensjoner og SHA-256. Viewportbilder er hovedgrunnlaget; full-page er supplement.

Publiser et oversiktlig `docs/design/review/round-8/`-sett. Manifestet skal skille kilde, origin/miljø, faktisk/isolert datatilstand, personantall, viewport og tema. Seks-personers-settet er den primære nye designvurderingen:

- Rik seks-personers Home på alle fem viewporter i begge temaer, fra isolert syntetisk API-/databasetilstand. Ta full-page desktop/mobil som supplement der det trengs for ærlig oversikt over reflow/scrolling.
- Alle øvrige medlemssider i tabellen: viewportbilder på 1920×1080 og 390×844, i begge temaer. Inkluder tydelig hovedtilstand og relevant innhold for hver side; merk tomme tilstander ærlig. Beskjeder-lanes og AI-oppsett trenger ekstra bilde bare når de viser en egen berørt komposisjon. Lag gjerne et kontaktark med lenker til individuelle originalfiler for effektiv helhetsreview; det erstatter ikke viewportbildene.
- Persondetalj og composer på desktop/mobil i begge temaer; representative innstillinger/redigerings-/bekreftelsesdialoger der delte komponenter er endret. Innlogging og invitasjon med syntetisk/inaktiv tilstand. Ikke publiser aktive koder eller secrets.
- Faktisk paired display med seks personer på 1920 i begge temaer, med riktige grants og uten medlemmenes compose.
- Fire-personers Home desktop i begge temaer for direkte komposisjons-/materialregresjon mot runde 7. Fem-personers-regresjon dekkes av latest og målrettet QA; åtte personer dokumenteres som stress. Ikke forveksle injiserte stresstilstander med faktiske baseline-captures.
- Alle sider skal også gjennomgås på iPad portrait/landscape og Shelly. Publiser supplerende viewportbilder for de sidene der reflow/navigation eller tett innhold endres vesentlig; rapporter de øvrige faktiske kontrollene uten mange identiske bilder.
- Offentlig miljø får egne tydelig merkede HTTPS-bevis etter deploy. Bruk bare egnet syntetisk/redigert innhold; aldri gjenbruk LAN-capture som påstått offentlig verifikasjon.

Bruk entydige filnavn/undermapper for side, personantall, datatilstand og miljø. Oppdater eventuelle avledede sammenligningsark med korrekt referanse/baseline/kandidat og merk perspektivnormalisering som omtrentlig. Latest-kontrakten forblir 14 ordinære bilder. Åpne bildene faktisk og iterer; en grønn geometritest er ikke tilstrekkelig når layouten fortsatt er ubalansert.

## Autorisert publisering til samvev.pabben.org

Publiser den ferdig testede kandidaten, uten merge til main, gjennom eksisterende Samvev-oppsett. Brukerens tillatelse er allerede gitt; gjør forarbeid, backup, utrulling og etterkontroll som del av denne runden.

1. Kartlegg nåværende Samvev-drift lesende før endring: aktiv offentlig container/image/source, Samvev-spesifikke Compose-overrides, DB/volum, migrasjonsledger, diskplass, rutemål og eksisterende kontotilgang. Dokumentene beskriver en tidligere immutable runtime ved `f82951b…` og 16 migrasjoner; dette er historikk, ikke bekreftet nåværende drift. Finn faktiske verdier. Ikke utforsk eller endre andre appers oppsett.
2. Behold den eksisterende offentlige installasjonens kontoer og data. Følg `M1_OPERATIONS.md` og `M1_RESTORE_GATE.md`. Ta en fersk privat backup og verifiser den etter etablert restore-gate før eventuelle nødvendige kanoniske migrasjoner. Behold forrige immutable image/konfigurasjon og en konkret databevarende rollback. Ingen gamle image-/schema-kombinasjoner skal startes blindt etter en migrasjon. Kun én worker per database.
3. Bruk Samvevs eksisterende immutable driftsløp/ignorerte lokale overrides, slik at senere QA-build ikke overskriver offentlige assets. Standard `compose.yaml` monterer arbeidskode; bruk ikke dette ukritisk til offentlig utrulling. Bygg/pin den ferdige kandidatens source og verifiser serverte filer mot den.
4. **Ikke eksponer LANs `admin/admin`-QA som offentlig backend.** Repoet har en konkret HTTPS-sperre: offentlig installasjon må være claimed og både database/env må ha demo mode av. Behold sperren, eksisterende normal passordverifisering og offentlig tilgangsvern. «Testversjon» er formålet med nettstedet, ikke tillatelse til å omgå auth-/demo-sperrer. Behold `admin/admin` på LAN. Bruk eksisterende offentlig testkonto eller etablert separat syntetisk testkonto med passende tilgang; ikke bytt eksisterende passord for å ta screenshots. Secrets håndteres privat på serveren og skal aldri i Git/rapport/chat.
5. Behold den etablerte Pangolin/Newt-veien for akkurat `samvev.pabben.org` og korrekt canonical origin `https://samvev.pabben.org`. Verifiser faktisk upstream og umiddelbar betrodd peer fra eksisterende oppsett; ikke hardkod historisk IP eller utvid trust til hele LAN/`true`/`*`. SSE skal fortsatt fungere uten buffering og med hensiktsmessig timeout. Endre bare Samvev-ressursen dersom nødvendig; ingen globale proxyendringer eller ny generell SSO-arkitektur.
6. Etter utrulling: åpne den faktiske HTTPS-adressen. Verifiser health, kandidatens assets/source, vanlig innlogging/utlogging, tema og faktisk navigasjon gjennom alle brukerflater på desktop/mobil. Kontroller relevant responsivitet, rettigheter/anonym tilgang, SSE og en egnet syntetisk brukerreise uten å endre bevarte data. Ikke påstå at en health-respons alene dokumenterer korrekt UI-deploy.
7. Behold LAN-QA healthy og bekreft fortsatt `admin/admin` der. Rapportér offentlig URL, deployet source, faktisk miljø-/innloggingskontroll og rollbackbevis separat fra review SHA/manifest. Hvis en konkret manglende credential, ressurs eller teknisk sperre ikke kan løses innen autorisert oppsett, fullfør resten og oppgi nøyaktig blokkering; ikke svekk sperren eller erklær publisering utført.

## Rapport, commit og avslutning

Skriv `docs/design/review/ROUND_8_REPORT.md` og oppdater prosjektstatus der repoet krever det. Oppgi endrede filer, felles designsystemgrep, seks-personers-layout, før/etter-funn, lukkede krav, faktisk testmatrise, materialbeslutning og begrensninger. Skill tydelig mellom isolert fixture, bevart LAN og offentlig testmiljø. Oppgi eventuelle kanoniske migrasjoner som faktisk ble anvendt offentlig, backup/restore-kontroll og databevarende rollback uten sensitive detaljer.

Commit med DCO-signoff og push bare featurebranchen:

```bash
git push origin feat/m3-family-hub
```

Rapporter source SHA, review SHA, round ID, manifest-/rapportlenker og status/lenke for den faktiske offentlige testversjonen. Publisering til `https://samvev.pabben.org/` er autorisert; ingen PR, merge, main-push, force-push, tag, release, Actions-dispatch eller uvedkommende driftsendringer. Ikke skriv egen designgodkjenning i mailboxen. Work gjør neste visuelle review mot originalene og hele den nye seks-personers-/sidebredden.
