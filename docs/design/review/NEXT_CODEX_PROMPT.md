# Samvev – runde 6: referanseparitet med ekte innhold og pålitelig AI-oversikt

Dette er én samlet implementeringsbestilling fra Pabben. Arbeid autonomt gjennom endringer, visuell iterasjon, målrettet verifikasjon og publisert review-evidence når mailboxen aktiveres. Ikke stopp etter første CSS-justering eller med en plan alene. Work er design-/produktreviewer; server-Codex utfører implementeringen.

## 1. Branch, kilde og føringer

- Repository: `pabben/samvev`.
- Arbeidsbranch: `feat/m3-family-hub`.
- Branch-head/review-commit kontrollert av Work: `b65842b1034ceae07d8e296874e3418779fa316d`.
- UI/source SHA for vurderte runde-5-bilder: `b6a30b2d95443a02192da7bc089820585fde8169`.
- Round ID: `20261004124113-b6a30b2d-7d49ba64`.
- Forrige sammenligningsrunde: source `8cc0236b4a3dd4ce43eee36591f74e75de6f4e88`, review `9a570b4932dac133222768955806a94b2cd22cf7`.

Denne mailbox-commiten kommer etter review-commiten; den endrer ikke hvilken UI-kilde bildene viser. Hent siste featurebranch gjennom etablert publishing-checkout, og bevar nyere arbeid. Ikke reset til SHA-ene over. Hovedcheckoutens `.git` er beskyttet; bruk etablert `.local/design-review-publish`.

Les `AGENTS.md`, prosjektkrav/arkitektur og relevante ADR-er, `docs/design/review/README.md`, `latest/manifest.json`, `ROUND_5_REPORT.md`, `docs/CHATGPT_PLAN_CONNECTION.md` og denne prompten. Følg prosjektets agentarbeidsflyt, med sekvensielle skrivende agenter, etterreview og release-gate.

Pabbens mål er fortsatt høyest praktisk visuell paritet med originalbildene. «8/10», moderne utseende eller grønne tester er ikke designgodkjenning. Samvev-navnet beholdes. Footeren med Samvev/slagord er fjernet og skal forbli borte. Persondetaljer og AI-/forbruksløsningen skal ferdigstilles innenfor eksisterende arkitektur.

## 2. Autoritative referanser og vurdert evidence

Åpne faktisk begge originalbildene:

- `docs/design/ChatGPT Image 24. sep. 2026, 23_51_09.png`
- `docs/design/ChatGPT Image 24. sep. 2026, 23_52_06 (4).png`

De overstyrer eldre SVG-er og mockups. Sammenlign appflatene, ikke rom, skjermrammer eller collage. Ikke kopier navn, eksempeltekst eller fiktive funksjoner fra referansene.

Work har åpnet begge referanser, alle 14 ordinære bilder og alle 20 supplerende runde-5-bilder, og sammenlignet med runde 4. SHA-256 og dimensjoner for alle 34 nye bilder er kontrollert. Testresultater i rapporten er lest; Work har ikke kjørt serverens tester eller live OAuth selv.

Ordinære bilder under `docs/design/review/latest/`:

| Viewport | Lys | Mørk |
|---|---|---|
| 1920×1080 | desktop-1920-light.png | desktop-1920-dark.png |
| 390×844 | mobile-light.png | mobile-dark.png |
| 820×1180 | ipad-portrait-light.png | ipad-portrait-dark.png |
| 1180×820 | ipad-landscape-light.png | ipad-landscape-dark.png |
| 1280×752 | shelly-1280-light.png | shelly-1280-dark.png |

Full-page-supplement: `desktop-1920-light-full.png`, `desktop-1920-dark-full.png`, `mobile-light-full.png`, `mobile-dark-full.png`.

Supplerende bilder under `docs/design/review/round-5/`, begge temaer for hver familie: `person-desktop-*`, `person-mobile-*`, `ai-settings-desktop-*`, `ai-settings-mobile-*`, `ai-usage-desktop-*`, `ai-usage-mobile-*`. Under `round-5/isolated-rich/`: `desktop-1920-*`, `mobile-*`, `ipad-portrait-*`, `display-1920-*`, også begge temaer. Les de tilhørende manifestene for eksakte filnavn, dimensjoner og datatilstander.

Viktig tolkning: Ordinære LAN-bilder har nå tomme dager etter naturlig utløp av demoens innhold. Dette er ikke bevis på at funksjoner har forsvunnet. Det isolerte, innholdsrike settet med tre dagsplanhendelser, påminnelser og en menneskelig melding er nødvendig for å vurdere prioriteringen. Ikke redater eller reseed LAN-data for penere bilder. Alle publiserte persondetaljer er tomme, og publisert AI-forbruk er ukonfigurert/uten registrert bruk; fylte tilstander trenger bedre review-evidence.

Bevar de faktiske forbedringene: gode lokale illustrasjonsavatarer, lagret eksplisitt avatarvalg, høye lyse personfelt, samlet mørk hovedrad, koordinert personfarge, direkte personinnganger, fjernet footer og fungerende zoom/fokus. Det er ingen bestilling om et nytt avatarsett eller å bygge hovedarkitekturen om igjen.

## 3. Syv prioriterte endringer

### P0-A – lys nedre komposisjon skal få referansens struktur

Hovedraden er betydelig nærmere. Den nedre silhuetten er fortsatt en annen: en svært bred meldingsflate til venstre, et høyt påminnelsespanel til høyre og ytterligere støttewidgets under første viewport. I det rike desktopbildet strekker den ene korte familiemeldingen seg over en omtrent 237 px høy flate. Originalen har en lavere, tydelig tredelt støtte-/melding-/støtte-rad, med meldingen som sosialt midtpunkt.

Bygg den lyse nedre raden rundt dette prinsippet med eksisterende, reelt innhold. Bruk omtrent 1:1,6:1 som første arbeidsforhold, og kalibrer mot selve referansen. Samle relevante liste-/brief-/påminnelsesinnganger i sidefeltene og gi den menneskelige meldingen en tydelig sentral plass. Reduser høyden gjennom prioriterte forhåndsvisninger og gode detaljinnganger; ikke bare skjul hele støtteinnholdet eller klipp meldinger med fast høyde. Ikke lag falskt vær, middag eller scenic-widget som later som den har data.

På 1920×1080 med den avgrensede rike testtilstanden skal hovedrad og denne lavere raden leses som to sammenhengende nivåer. Unngå en tredje administrativ oppsummeringsrad som starter med avkuttede kort nederst. Lengre eller flere meldinger kan fortsatt kreve naturlig scrolling. Bevar den mørke referansens egen brede meldingsflate med mindre støttefelt; ikke påtving mørk samme tredeling.

### P0-B – rett prioriteringen på mobil og iPad med innhold

I rik lys mobil tar hilsen/status/personer omtrent de første 255 px; to påminnelseskort og en stor melding skyver «I dag» til rundt y=743, bak bunnavigasjonen. Ingen dagsplanhendelse er synlig. Rik mørk mobil viser bare to av tre komplette dagsplanrader fordi innledningen, fokusområdet og handlingene tar for mye høyde. På iPad portrait bruker store 2×2-personfelt så mye plass at viktige påminnelser og familiemeldingen havner nederst eller under første viewport.

Løs dette gjennom innholdsprioritering, ikke liten tekst:

- Lys mobil skal beholde familiefeedens karakter: kompakt hilsen/personvelger, en prioritert påminnelse med inngang til resten, en kort menneskelig meldingsforhåndsvisning og synlig neste dagsplanhendelse. Den synlige hendelsen er en praktisk produktprioritering, ikke en bokstavelig regel fra lysreferansen. Vis totalantall når noe er sammenfattet. Hele meldingen skal kunne åpnes. Ikke press inn alle desktop-moduler.
- Mørk mobil skal følge originalens korte hilsen, personer, ett relevant fokusområde, reelle hurtighandlinger og kompakte dagsplanrader. Med tre korte testhendelser skal alle tre radene være komplett synlige over bunnavigasjonen ved 390×844. Innhold som ikke passer har en synlig inngang.
- Slå sammen overflødig header-/statusluft. Behold lesbar informasjon om offline/feil og den nødvendige merking av syntetisk demo. En normal «direkteoppdateringer»-status trenger ikke en hel romslig rad.
- På 820×1180: behold hensiktsmessig to-kolonnestruktur og 2×2-personidentiteter, men reduser vertikal plass per personfelt, særlig tomme deler. Første viewport i begge temaer skal vise dagsoversikt samt minst én faktisk påminnelse og en menneskelig meldingsforhåndsvisning/inngang med avsender. Ikke erstatt dette med en enslig generisk «Mer»-knapp. Rekkefølge i DOM og på skjerm skal være forståelig.

Disse målene gjelder vanlig zoom, fire personer og den spesifiserte rike tilstanden. Ikke hardkod navn, klokkeslett, antall familiemedlemmer eller skjulte radgrenser som mister informasjon. Ved åtte personer, lang tekst eller 200 % zoom prioriteres lesbar reflow og tilgang til alt innhold fremfor samme førsteskjermmengde.

### P1-C – samordne materialer, typografi og display

Lyse personflater og avatarer er bedre, men bakgrunnen er fortsatt mer en jevn blå/mint-gradient enn originalens organiske, varme komposisjon. Typografi, metadata og mange generiske ikoner gjør informasjonsflatene mer administrative. Mørke paneler er tydelige, men flere flater virker ensartet ugjennomsiktige fremfor lagdelt glass.

Kalibrer bakgrunnsformer, varme leseflater, blå/navy titler, aksentfarger, radius, border, lyskant og myk skygge mot de to originalene. La bakgrunnen være synlig nok til å skape materialfølelse, samtidig som tekstkontrasten bevares. Bruk differensiert ikonografi fra eksisterende system for kjente innholdstyper; ikke gjett aktivitetstype fra personnavn eller generer ikon med AI. Behold ro i metadata og tydelig forskjell på personnavn, seksjonstittel, hendelsestittel og kilde/tid. På brede lyse personkort møter omtrent 160 px portretter relativt små navn og aktivitetsoverskrifter. Styrk disse tekstnivåene, flytt detaljpilen nær identiteten fremfor en egen romslig rad, og stram inn avstanden til første aktivitet uten å reversere de slanke kortproporsjonene.

Det lyse faktiske display-bildet har en flat beige bakgrunn der innlogget Home har blå/mint-atmosfære. Gjenbruk relevant tema/materiale på tvers av skallene slik at kjøkkenskjermen oppleves som samme produkt. Behold displayets egne rettigheter, navigasjon og lesbarhet på avstand. Ingen nye konto-/AI-innstillinger på display.

### P1-D – persondetaljer med reelt innhold

Bevar drawer på store skjermer og sheet på mobil, med samme valgte identitet. Publisert evidence viser bare tomme personer og kan derfor ikke dokumentere den etterspurte detaljopplevelsen.

Vis eksisterende `endsAt` sammen med `startsAt` når begge finnes; `ItemCard` viser nå bare start. Bruk korrekt lokalisert tidsintervall, også over datoskifte, og bevar sted, full tekst og kilde når tilgjengelig. Innhold om en annen person skal ikke merkes «Til deg» på en måte som peker på innlogget bruker; bruk for eksempel personens navn eller en nøytral etikett. Stram inn gjentatte identitetsoverskrifter og unødvendig tom luft.

Hold deg til den autoriserte Home-projeksjonen. Dette er personens aktive, tilgjengelige familieinformasjon, ikke en komplett biografi, historikk eller privat innboks. Ikke hent administrative felt for å fylle flaten. Fellesinnhold må fortsatt være skilt fra personens egne oppføringer. Kontroller direkte åpning med 0, 1 og flere oppføringer, oppdatering/utløp og fokusretur.

### P1-E – AI og forbruk må bli en oversikt, med oppsett ved behov

Den publiserte mobile siden er over 6000 px høy når veiledningen er åpen. Forbruk og kostnad kommer etter omfattende konfigurasjon og terminalkommandoer. Det gjør brukerens hovedspørsmål – «hva bruker jeg, og hva kan samme bruk koste?» – unødvendig vanskelig å besvare.

Gi siden en kompakt oversikt øverst: tilkoblingsstatus, valgt bruksvei, måleperiode, registrert bruk, kjent/ukjent kostnadsgrunnlag og lenke til ChatGPTs faktiske kontooversikt. Skill «Forbruk» og «Tilkobling/oppsett» med tilgjengelige faner eller tydelige seksjonsinnganger; detaljfordeling, priskilder og operatørkommandoer åpnes ved behov. Ikke fjern forbehold som er nødvendige for å tolke tallene. «Valgt bruksvei» er mer presist enn «Aktiv bruksvei» når AI er av og ingenting er konfigurert.

Bevar den dokumenterte lokale samtykke-/sikker importflyten. Gjør den forståelig som tre konkrete steg: godkjenn på nettlesermaskinen, overfør sikkert, importer på denne Samvev-serveren. Oppgi hvor hvert steg utføres, nødvendige forutsetninger og hva som bekrefter at steget lyktes. Bruk faktisk tilgjengelige nedlastingslenker og eksisterende trygg kontekst for kommandoer. Ikke gjett SSH-bruker, ikke presenter containerversjonen som en lokal npm-installasjon, og ikke lat som LAN-nettleseren kan fullføre VM-loopback alene. Tilkobling skal ikke kreve at tokens limes i chat eller i et usikret LAN-skjema.

Kontospesifikt samtykke, eligibility og faktisk kredittbelastning er fortsatt uverifisert. Implementert og mock-testet er ikke det samme som live tilkoblet. Denne runden kan fullføres med den begrensningen presist dokumentert og en kort, gjennomførbar brukerhandling. Ingen skjult API-fallback eller nye betalte prøvekjøringer.

### P1-F – rett to konkrete feil i kostnadsgrunnlaget

Work har lest de relevante kodebanene i `services/api/src/ai/admin-service.ts`. Bekreft funnene med målrettede regresjonstester før retting:

1. `priced` kontrollerer tokenfelter, men krever ikke at `LEFT JOIN ai_rate_snapshots` faktisk fant en gyldig prisrad. Når alle tokenkategorier er oppgitt og pris/modell/tier er ukjent, kan forsøket telles som prisberegnet samtidig som NULL-beløpet summeres til 0. Krev et faktisk kompatibelt prissnapshot og nødvendige satser/enheter. Manglende pris skal gi ukjent andel og sperre en komplett prognose; aldri fremstå som gratis bruk. Bevar gyldige nullsatser og reelle nullbruksdager som noe annet enn manglende data.
2. Prognoseutvalget filtrerer på `actual_dispatch=true`. Et eldre `started`-forsøk med `actual_dispatch=NULL` etter et krasj kan ha nådd leverandøren, men forsvinner fra datadekningen. Med andre kjente kall kan prognosen likevel fremstå komplett. Ta med relevante uavklarte forsøk/historiske ukjente i usikkerheten innen riktig periode, eier, bruksvei og kategori. Et uavklart forsøk må ikke oppgraderes til bekreftet belastning, men kan heller ikke behandles som bevist null. Vurder varig dispatch-markering der det faktisk forbedrer korrekthet; ikke påstå at en lokal markør alene beviser leverandørens fakturering.

Bevar skillet mellom ChatGPT-kreditter, separat API-sammenligning, lokal provider og test/drift. Vis kjent del, ukjent del og hvorfor månedsprognosen eventuelt er foreløpig. Ikke beregn saldo eller desemberutløp uten kontogrunnlag. Historiske snapshots, idempotens, cached input/cache-write og nullbruksdager skal fortsatt behandles riktig. Ikke bygg ny faktureringsplattform.

### P1-G – behold gyldig tilkobling ved midlertidig valideringsfeil

I `services/api/src/ai/chatgpt-oauth.ts` går alle feil i valideringen etter vellykket refresh til en catch som nuller credentials og krever ny autorisering. Valideringen kan hente discovery/JWKS over nettverket. En midlertidig nettverksfeil etter at refresh-token er rotert kan dermed miste den nye tokenpakken og påføre brukeren unødvendig ny innlogging.

Skill midlertidig valideringsutilgjengelighet fra faktisk ugyldig signatur, utsteder, mottaker, subject, scope eller terminalt tilbakekalt token. Bevar nødvendig ny tokenpakke sikkert og kryptert gjennom en midlertidig feil, med eksplisitt uverifisert tilstand. Ikke tillat inference før pakken er validert, og ikke bruk det gamle roterte refresh-tokenet på nytt. Bevar serialisering, konto-/husstandsgrenser, revokering og dokumentert terminalfeilhåndtering. Velg minste robuste endring i eksisterende arkitektur.

Kontroller samtidig gjenopptakelse av companion-flyten: utstedt client-ID må kunne gjenbrukes etter avbrutt første tokenutveksling, og veiledningen må ikke kreve et gammelt credential-dokument som den samtidig har bedt brukeren slette. Bevar nødvendige registreringsopplysninger trygt uten å beholde unødvendige tokenkopier eller publisere kontoidentitet. Følg gjeldende offisiell OpenAI-dokumentasjon for selvhostede apper ved endring av OAuth-kontrakten.

### P2 – avsluttende polering

Etter de syv punktene: juster avatarens glød/kant, ikonbaselines, metadataavstander og dialogoverskrifter. Behold nyttige tomtilstander, men la dem ikke skape unødvendig store paneler på mindre skjermer. Ikke bruk hoveddelen av runden på små skyggeendringer.

## 4. Responsivitet, tilgjengelighet og bevaring

- 1920×1080: kalibrer hovedsilhuett og nedre rad mot hvert temas original; ikke gjør mørk og lys til samme layout.
- 1180×820 og 1280×752: bevar personidentitet, agenda og tydelig melding-/påminnelsesinngang i første viewport. Reduser luft og antall previews fremfor tekststørrelse. Ingen avkuttede kontroller eller utilsiktet horisontal scroll.
- 820×1180 og 390×844: oppfyll P0-B med rike data og kontroller også tomtilstand. Bunnavigasjon/safe areas må ikke dekke rad eller handling.
- 1, 4 og 8 personer, lange navn, lange meldinger, tomme og innholdsrike dager skal fungere. Fullt innhold skal være tilgjengelig, uten hardkodede personer eller oppdiktede hendelser.
- Minst 44×44 trykkflater, synlig fokus, semantiske knapper, tilgjengelige faner/dialoger, korrekt leserekkefølge, Escape/fokusretur og ingen nestede knapper. Kontroller faktisk 200 % nettleserzoom, reduced-motion og fallback uten backdrop blur på endrede flater.
- WCAG AA måles på faktisk kompositerte flater. Status/person skiller seg med mer enn farge. Behold NB/EN og light/dark/system.
- Bevar serverfiltrert Home, display-grants, eier-/husstandsgrenser, kildeinformasjon, SSE, utløp/offline, ekte meldinger, avatarvalg og ordinær innlogging.
- Bevar syntetisk LAN med `admin/admin`, eksisterende data og beskyttet `.git`. Ingen passordreset, reprovisionering, reseed eller redatering for screenshots. Bruk isolert syntetisk testdatabase for fylte tilstander og feilscenarier.
- Ingen private data, kontoidentitet, saldo, tokens, OAuth-koder eller hemmeligheter i Git/evidence. Ikke les Codex' egne credentials. Ingen ny generell chat, ny providerarkitektur, ny scheduler, main-endring eller produksjonssetting.

## 5. Akseptanse og verifikasjon

Runden er ferdig når de konkrete forholdene nedenfor er dokumentert, ikke bare når testene er grønne:

1. Side-ved-side-sammenligning viser korrigert lys nedre komposisjon, fortsatt samlet mørk komposisjon og tydelig felles materialfølelse mellom Home/display. Originalenes visuelle prioritering skal være gjenkjennelig med reelt innhold.
2. Den rike mobiltilstanden viser minst neste hendelse i lys feed og tre komplette dagsplanrader i mørk, sammen med personinnganger og tilgjengelig viktig innhold. Rik iPad portrait viser faktisk påminnelse og familiemeldingsinngang med avsender i første viewport. Ingen løsning baseres på mindre enn lesbar tekst eller skjult informasjon.
3. Persondetaljer viser fullstendig tilgjengelig tekst, korrekt person/felles-gruppering og tidsintervall der data finnes. 0/1/flere, liveoppdatering, utløp og fokus er kontrollert.
4. AI-oversikten gjør status, periode og forbruk tilgjengelig uten å scrolle gjennom oppsettveiledningen. Ukjent/foreløpig, kontoens faktiske saldo og Samvevs egne estimater er tydelig atskilt.
5. Manglende prissnapshot og uavklarte forsøk kan ikke gi feilaktig kjent nullkostnad eller komplett prognose. Transient valideringssvikt etter tokenrotasjon kan gjenopprettes uten å svekke identitetskontroll eller gjenbruke gammelt refresh-token.
6. Ingen regressjon i etablerte temaer, rettigheter, innlogging, API-/lokalrute eller beskyttelse mot betalt fallback. Uverifisert live OAuth er merket ærlig.

Kjør `npm run check --workspace @samvev/web`, `npm run test --workspace @samvev/web` og faktisk registrerte check/build/test-scripts for endrede API/contracts/core/worker-deler. Inkluder relevante `services/api/src/ai/*.test.ts` eksplisitt hvis prosjektets testglob ellers utelater dem. Bevis endrede kodebaner; ikke kjør destruktive tester mot bevart QA.

Nødvendige målrettede regresjoner: full tokenrapport uten matchende pris/modell/tier, blandet kjent/ukjent pris, uavklart sendt-forsøk sammen med kjente kall over komplett måleperiode, kjent preflight-avvisning som ikke teller som belastning, nullbruksdager, refresh med midlertidig discovery/JWKS-feil etter rotasjon og senere vellykket validering, terminalt ugyldig identitet/scope, samt companion-gjenopptakelse. Test kostnad gjennom relevant faktisk SQL-/servicebane, ikke bare en kopi av formelen i en mock. Bruk injiserbar leverandørtransport og isolert database; ekte betalte kall er ikke nødvendig.

Nettleser-QA dekker endrede breakpoints med rike og tomme data, persondetaljer med 0/1/flere, AI-oversikt/oppsett, tastatur/fokus, Axe, kontrast, zoom/fallback og relevante M3-regresjoner. En liten test for formattering av tidsintervall er tilstrekkelig hvis øvrig personinteraksjon allerede er dekket. Kjør prosjektets påkrevde etterreview/release-gate; ikke gjenta brede tester uten konkret risiko eller påkrevd gate.

Åpne kandidatbildene mot originalene før avslutning. Juster på nytt dersom P0-funnene fortsatt er synlige. Ikke skriv «ingen blokkerende visuelle avvik» mens kjent informasjon fortsatt ligger utenfor de avtalte førsteskjermmålene. Dokumenter konkrete restforskjeller fremfor en ubegrunnet poengsum.

## 6. Capture og publisering

Følg gjeldende review-README, inkludert runtime-proveniens for backendendringene. Lag DCO-signert source-checkpoint i etablert publishing-checkout, og synkroniser tillatte QA-inputs byte-identisk uten å endre hovedcheckoutens beskyttede Git-metadata. For den ferdige kandidaten:

```bash
bash scripts/design-review-runtime.sh
bash scripts/design-review-build.sh
# Kjør målrettet nettleser-QA mot denne kandidaten.
bash scripts/design-review.sh
```

Bruk rutinenes egne låser/avgrensninger. Backend, web-assets, byggebevis og manifest skal vise samme kilde. Bevar qa-db og eksisterende innhold; bruk bare README-autoriserte omstarter av dette prosjektets QA-tjenester. Dette gir ingen tillatelse til produksjonsdeploy. Ingen rebuild etter endelig capture uten ny nødvendig QA/capture.

Regenerer og åpne alle 14 ordinære latest-bilder med eksakte navn fra tabellen og full-page-listen over. Arkiver forrige gyldige sett, og kontroller source SHA, round ID, viewport, tema og hash. Full-page erstatter aldri viewportbildene.

Publiser et avgrenset supplement under `docs/design/review/round-6/` med manifest som angir kilde, viewport, tema, datatilstand og eventuell injisert transport:

- Rik Home på desktop, mobil, iPad portrait, iPad landscape og Shelly i begge temaer; tre korte dagsplanhendelser, relevante påminnelser og en menneskelig melding. Dette må bevise prioriteringen også på de to mindre brede formatene.
- Faktisk paired display på 1920 i begge temaer, for sammenheng i materialer og rettigheter.
- Fylte persondetaljer på desktop/mobil i begge temaer, med et synlig tidsintervall og felles/personlig innhold. 0/1/flere kan dekkes med målrettet QA; ikke publiser mange like tomme bilder.
- AI-oversikt på desktop/mobil i begge temaer med tydelig merket syntetisk registrert bruk, inkludert en ukjent/foreløpig tilstand. Vis også relevant tilkoblings-/gjenopprettingsflyt i et lite eget utsnitt. Ikke fremstill syntetisk connected-tilstand som verifisert faktisk kontotilgang.

Bruk isolert syntetisk database/server og eksisterende harness der det er egnet. Hold ordinær latest-kontrakt på 14 bilder. Tillegg er test-evidence, ikke tillatelse til å endre LAN-data eller belaste en konto. Unngå å bruke full-page-bilder på mange tusen piksler som eneste bevis på mobilbrukbarhet.

Skriv `docs/design/review/ROUND_6_REPORT.md` og oppdater prosjektstatus der repoet krever det. Oppgi endrede filer, faktisk forbedring mot runde 5/originalene, relevante testbevis, eventuelle additive migrasjoner med databevarende rollback, restavvik og live-tilkoblingens faktiske status. Hvis samtykke gjenstår, gi én kort konkret brukeroppskrift med tydelig maskin/steg; ikke lov kjent saldo eller kostnad uten grunnlag. Behold QA-tjenestene healthy og verifiser `admin/admin` uten passordendring.

Commit med DCO-signoff og push kun featurebranchen:

```bash
git push origin feat/m3-family-hub
```

Rapporter source SHA, review SHA, round ID og lenker til manifest/rapport. Ingen PR, merge, deploy, main-push, force-push, tags, release eller Actions-dispatch. Ikke overskriv mailboxen med egen designgodkjenning. Work gjør neste visuelle review når evidence er pushet.
