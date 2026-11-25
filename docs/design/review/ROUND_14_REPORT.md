# Runde 14 – leveranserapport

**Status: implementert, review-godkjent og publisert på [samvev.pabben.org](https://samvev.pabben.org/). Offentlig HTTPS-kontroll bestått 28. oktober 2026 kl. 03:59 UTC. Eksterne eierhandlinger står separat.**

- Source/deploy SHA: `971913e321dd82f491214fdbda81d08f8123a891`.
- Kandidatimage: `sha256:4aef88306949a5b591e4af94ce0e769d3dffe73526dad663fa90ab8e44160342`.
- Kanonisk Round ID: `20261028032511-971913e3-046fbbb8`.
- [Visuell evidens: 70-bilders matrise, sju tillegg og sammenligningspaneler](round-14/README.md), [manifest](round-14/manifest.json), [siste manifest](latest/manifest.json), [kravmatrise](ROUND_14_REQUIREMENTS.md), [eierhandlinger](ROUND_14_OWNER_ACTIONS.md), [testbevis](ROUND_14_TEST_EVIDENCE.json).
- Review-SHA er Git-commiten som publiserer denne rapporten og bildene; oppgis i sluttmeldingen etter commit.

## Endringene

Forsiden har en samlet komposisjon med dagskort, kompakte personkort og beskjed/bilde ved siden av hverandre. Felles farger, glassflater, typografi, kontroller og fokus følger undersidene. Nettbrett bruker to navigasjonsrader når det trengs. Ved manglende smarthjeminnhold balanseres de tre tilgjengelige kortene; familieoversikten fyller siste nettbrettrad. Tomme kalenderseksjoner skjules på skjermer. Samvevs navn er beholdt og familieforsiden har ingen dekorativ footer.

**#15:** Kalenderen har korte rader med tid/heldag, nødvendig status og tittel. Trykk eller tastatur åpner detaljer. Avlysninger er synlige. Personfarger lagres på serveren, kan endres med riktig tilgang og brukes i kalender, personer og avsenderidentitet. Seks standardpersoner får ulike farger; paletten har tolv valg og deterministisk gjenbruk etter dette. Navn/detaljer gir informasjon utover fargen.

**#14:** Kalender med lenke bruker den eksisterende ICS-motoren. Forhåndsvisning, personkobling, lesere og skjermer er separate valg. Synkstatus viser siste vellykkede og neste planlagte henting, feil og utdatert innhold. Standardintervallet er fortsatt 15 minutter; 5 og 30 kan velges. Oppdater nå har samtidighets-/frekvensvern. Leverandørens egen forsinkelse kommer i tillegg; ingen maksimal ende-til-ende-forsinkelse er lovet. Hemmelige abonnementslenker skal ikke gjøres offentlige.

**#13:** Claude/Anthropic er integrert i eksisterende AI-arkitektur med kryptert nøkkel, modellvalg, egne forbindelsestester, faktisk rute-/modellinformasjon og tilgjengelige forbruksdata. Reserveleverandør er av som standard og krever eksplisitt valg. Den kan bare brukes én gang før en vellykket samtaletur/verktøyhistorikk, ved avgrensede forbigående feil. Nye reparasjonsrunder bytter ikke automatisk tilbake. En valgfri UTC-døgngrense teller faktiske API-forsøk, også tester og reserveforsøk; dette er ikke en penge- eller tokengrense. ChatGPT-abonnement inngår ikke i automatisk reserve. API-kreditter og fakturering følger leverandørens gjeldende organisasjon/vilkår, ikke antakelser i adapteren. Se [ADR 0025](../../decisions/0025-opt-in-ai-fallback-and-dispatch-limits.md).

## Kontrollbevis

Alle tester kjørte på eksisterende lokale maskiner/runnere med isolerte syntetiske data. Sluttkilden bestod alle workspace-typekontroller og **526 tester**: web 153, contracts 5, core 3 og API 365; worker har ingen tester. Hovedagenten kontrollerte faktiske logger og exit-koder. Ytterligere 32 review-helpertester, én nettlesertest av personvernmaskering og 19 restore-/schema-/wiring-fixtures bestod.

Faktisk nettleserflyt kontrollerte ICS-forhåndsvisning, separate mål, aktivering, intervall, ny åpning og manuell oppdatering. En injisert hentefeil beholdt siste vellykkede tidspunkt og innhold, viste utdatert-status og kunne gjenopprettes. Faktisk AI-skjema ble brukt med syntetisk transport; forbindelsestest brukte ikke reserve, mens en separat normal analyse brukte den eksplisitte reserven ved injisert feil. Ingen ekte modellkall ble sendt. Tastatur, farger, mediebilder, 56 navigasjonsgeometrier og 20 tomme/befolkede forsidevarianter ble kontrollert.

Det faste reviewløpet bygger nå en ren kilde separat fra aktiv LAN-dist og aktiverer ferdige filer atomisk. QA-appens oppstart bygger ikke lenger over aktive filer. Kilde, runtime, migrasjoner, filer og serverte filhasher er bundet sammen; hovedcheckoutens beskyttede Git er bevart. Alle tolv webfiler i kandidatimage matcher QA-filene. LAN-demoens faktiske innloggingsskjema og utlogging ble kontrollert.

Isolert restore av offentlig backup bestod 28 kontroller: eksakt 037→041, ny migrering uten endring, bevarte gamle kolonner/verdier/rettigheter, elleve nye kolonner, bevarte constraints, integritet/amcheck, bilder, API-tilgang og eksisterende syntetisk kontoinnlogging. Klonene hadde ingen worker, vault-/leverandørmount eller vertsporter og ble ryddet opp etter kontroll. Offentlig utrulling er gjennomført. En ny, rolig 037-backup ble gjenopprettet og migrert isolert før livebyttet. Live migrasjoner 038–041 og ny kjøring uten endring bestod; gamle kolonner/verdier, databaseidentitet, volum, vault, miljø og runtimeinnstillinger ble bevart. App og worker er friske på det kontrollerte imaget. En ny 041-backup etter utrulling ble også gjenopprettet og kontrollert uten schema-/migrasjonsendring. Hovedagenten verifiserte faktiske kvitteringer og runtimeimage.

## Visuell vurdering og avgrensninger

UX-review av sluttkandidat `971913e` er **PASS**. Den faktiske 70-bildersmatrisen dekker 11 medlemssider i desktop, mobil og nettbrett stående, i lyst og mørkt tema, samt fire Shelly XL-visninger. Sju tillegg dekker Anthropic-oppsett i seks visninger og syntetisk ICS-feil-/gjenoppretting. Se [bildeindeks og hashmanifest](round-14/README.md) og [sanitert evidensmanifest](round-14/manifest.json).

Referansebildet ble åpnet og sammenlignet med ekte før-/etterbilder. Førkilden `0f80840` har samme applikasjonskode som offentlig R13 `7c61557` etter kontroll av hovedagenten; skjermbildet er likevel gjengitt fra det isolerte arkivet, ikke tatt fra live offentlig side. De mørke førbildene er ikke listet eller hashet i opprinnelig førmanifest, og manifestet mangler fangsttidspunkt. Direkte bildehasher og filsystemtid som begrenset tidsproxy står i [sammenligningsmanifestet](round-14/comparisons/manifest.json). [Desktop-sammenligningen](round-14/comparisons/home-desktop-dark-panel.png) og [mobil-sammenligningen](round-14/comparisons/home-mobile-dark-panel.png) er merkede kompositter, ikke app-skjermbilder.

Den separate 14-bilders LAN-serien bevarer eksisterende fem syntetiske personer og maskerer innhold. Hovedmatrisen for sluttkandidaten bruker i stedet en isolert seks-personers syntetisk fixture med to voksne og fire barn. LAN-data ble ikke erstattet for å lage bilder. Tidligere avviste nettbrett-/loading-/fixturebilder beholdes som privat iterasjonsbevis, ikke som godkjent sluttresultat.

Lyst skjermtema beholder større portrettkort for gjenkjenning og lesbarhet; mørkt tema følger den kompakte glassreferansen tettere. Seks personer, lange navn og eksplisitte delingsvalg gir reelle avvik fra referansens tre personer. En tom skjerm uten delinger er korrekt tilgangsbegrensning, ikke bevis for en befolket familieoversikt. Ekstra valgte kort kan kreve scrolling. Den visuelle godkjenningen gjelder kilde `971913e`; samme kilde og identiske webfiler er offentlig publisert og etterkontrollert.

## Drift og gjenoppretting

Migrasjonene 038–041 legger til personfarger, ICS-intervall, Anthropic-valg og avgrenset reserve-/forbruksmetadata. Gamle AI-rader beholder reserve/grense som NULL. Ingen oppdrag kopieres og ingen godkjenning eller tidsplan endres. Gjenoppretting er fremoverrettet etter stans av app/worker; gamle databaser skal ikke legges over nye brukerendringer. Før byttet ble ny rolig backup og isolert migrasjonstest gjennomført; etter byttet ble en ny backup tatt og gjenopprettet isolert.

Ingen PR, merge, main-/force-push, Git-tag/release eller Actions-dispatch er bestilt eller utført. Kildekandidaten er DCO-signert og pushet kun til featurebranchen. Offentlig testpublisering og HTTPS-kontroll er fullført. Ingen private familieopplysninger, nøkler, kalenderlenker eller ekte bilder skal inn i Git eller publiserte skjermbilder.

## Arbeidsdeling og ressurser

Avgrenset implementering, QA, dokumentasjon og driftsforberedelser brukte `gpt-6-luna` med high. Vanskelige layout-/AI-/pipelineoppgaver og sikkerhetsreview brukte `gpt-6.1-sol` med high. Skrivearbeidet var sekvensielt; hovedagenten kontrollerte diff, logger, kilde-/filhasher og faktiske bilder og sendte konkrete funn tilbake. Uavhengig release-gate (`gpt-6-astra`, xhigh) godkjente kandidaten for offentlig testutrulling; offentlig sluttkontroll er bestått; endelig leveransevurdering dokumenteres i testbeviset. Nøyaktige token-/kostnadstall for denne runden er ikke tilgjengelige; ingen besparelse estimeres.

## Faktisk offentlig kontroll

Den beholdte syntetiske testkontoen logget inn og ut gjennom det ekte skjemaet over HTTPS. Ni medlemsdestinasjoner ble åpnet direkte og oppdatert på desktop og mobil uten horisontal overflow. Kalenderens tomme uke, ICS-dialogen, Anthropic-oppsettet og navigasjon til skjermer ble kontrollert. Alle tolv offentlige webfiler matchet kandidatens hasher. Anonyme konto-/skjerm-API-er avviste tilgang. Ingen preferanser ble endret, ingen kalender opprettet og ingen modellforespørsel startet.

Testkontoen hadde ikke `people.manage`; personfargeredigering er derfor **syntetisk verifisert, ikke offentlig redigeringsverifisert**. Den offentlige testkontoens kalender var tom; befolkede kalenderrader/avlysninger og reell skriveflyt ble kontrollert i det isolerte miljøet. Ekte private ICS-, OAuth- og Anthropic-koblinger er ikke påstått live-verifisert.

Offentlige sider bestod anonym direkte åpning og oppdatering: [Om Samvev](https://samvev.pabben.org/om), [Personvern](https://samvev.pabben.org/personvern), [Bruksvilkår](https://samvev.pabben.org/vilkar). Direkte innganger: [Kalender](https://samvev.pabben.org/?tab=calendar), [Integrasjoner / ICS](https://samvev.pabben.org/?tab=integrations), [AI / Claude](https://samvev.pabben.org/?tab=ai).

Det er ikke introdusert hemmeligheter eller private familie-/kalenderdata i denne reviewleveransen. Publiserte bilder bruker syntetisk innhold. Bygget har fortsatt Vites varsel om JavaScript-chunk over 500 kB; bygg og funksjonskontroller bestod.
