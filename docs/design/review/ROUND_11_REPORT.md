# Kalender-GUI og Spond via Home Assistant

Implementeringspakke aktivert fra mailbox `23c01cc4fd849448060633825f1d6d368a46b6f3`, ikke en ny generell designrunde.

| Versjon | Verdi |
| --- | --- |
| Endelig kilde | `585a7204ce89bc7e953f6b79cf871c1845a12f9f` |
| Kandidatimage | `sha256:5f63b1afb11d68aea1fdb8e1bc72cad2c099f1bab4377f7cc8aee6581d6eee12` |
| Faktisk offentlig source/deploy | `ca7359b0ce511f930aec3df0e11ce94ac4d203e6` — uendret R10 |
| Faktisk offentlig image | `sha256:8fa9329df7a59773d1f294e030d045605cd14ad94ba6e8d557588a247f37a341` |
| Screenshot-runde | `20261014223031-585a7204-59693e69` |
| Review-versjon | DCO-commiten som inneholder denne rapporten og bildene; eksakt SHA rapporteres ved push. Den endrer ikke applikasjonskilden. |

## Implementert og tilgjengelig

Kandidaten kjører i LAN-demoen på [192.168.0.220:4173](http://192.168.0.220:4173/). **Den er ikke publisert på offentlig testserver:** målt diskplass er utilstrekkelig også når backuprestore utføres lokalt. R10 på [samvev.pabben.org](https://samvev.pabben.org/) er bevart og kontrollert over ekte HTTPS. Ingen ny generell deploygodkjenning trengs; kapasitetskravet må oppfylles før allerede autorisert publisering.

- Google Kalender og Outlook/Microsoft 365 har direkte, lesende kontotilkobling, kildevalg, separate personer/lesere/skjermer, forhåndsvisning, aktivering, oppdatering, ny innlogging og frakobling. Barn som emne gir ikke automatisk leser- eller displaytilgang. Flere kontoer og kalendere er adskilt.
- Installasjonsadministrator har eget engangsoppsett med offisielle registreringsinnganger, korrekt kopierbar returadresse, validert Google WEB-JSON-import/manuelt alternativ og Microsoft-skjema. Vanlige familiemedlemmer håndterer ikke klienthemmeligheter. Serveren håndhever aktiv sesjon og voksen-/installasjonsmyndighet; husstandsadministrator er ikke automatisk installasjonsadministrator.
- Registreringene lagres kryptert i eksisterende vaultmodell og database. Uten DB-rad brukes eksisterende miljøkonfigurasjon; lagret/disabled rad er autoritativ og faller ikke tilbake. App og worker bruker samme kilde. Hemmeligheter returneres aldri. Rotasjon fencer pågående arbeid; endret klient krever ny autorisasjon.
- Spond → Home Assistant → Samvev er implementert med nettleserautorisasjon, faktisk discovery-kontrakt for Spond Tracker-kalendere, stabil registry-ID, eksplisitt personkobling, forhåndsvisning og fullsnapshot/synk. HA er valgfritt for øvrige kalendere. Ingen Spond-passord, accept/decline-tjenester, kalenderwrites, AI-oppdrag eller poengoppgaver innføres.
- HA-adapteren bruker eksplisitt godkjent origin, DNS-pinning, begrensede HTTP-/WebSocket-lesekall og absolutte frister. Entitetsfiltrering begrenser importen, ikke nødvendigvis HA-tokenets underliggende rettigheter. Ingen offentlig HA-eksponering, Pangolin-endring, reinstallasjon eller omstart er utført.
- Ved feil beholdes siste gyldige innhold med synlig utdatert-status og siste vellykkede oppdatering. Frakobling stopper videre henting uten å slette egne Samvev-avtaler. Manglende kilder har rediscovery-handling.

Spond-støtten gjelder arrangementer og forpliktelser **som den faktiske kalenderkilden eksponerer**, ikke en garantert komplett oppgaveliste. Trackerens avgrensede cache, filtrering og mulige fornavnskollisjoner synliggjøres. Ingen automatisk personmatching eller fuzzy sammenslåing mellom HA og Google/Outlook. Manglende strukturert deltakerstatus forblir ukjent. Installerte entiteter, versjon og datatilgang er ikke undersøkt live; upstream-referansen er ikke et installasjonsbevis. Se [HOME_ASSISTANT.md](../../HOME_ASSISTANT.md).

## Tester og visuell iterasjon

Endelig isolert samlet retest: **351/351**, null feil/skips/cancels: web 84, kontrakter 5, core 3, API 259. Worker har ingen egne enhetstester; livsløp dekkes av integrasjon. Alle fem workspace check/build består. Fullt kanonisk Git-archive runtime-build består; alle **240** kildeinput samsvarer mellom checkout, arbeidsfiler og image, og alle **10** webassets samsvarer med kjørende QA. Fingerprint: `14e49b57be14303018565cbc1915f96521a6c0a835ba52eb57ddf79336d84adb`.

Pipelinekontroller: 16 hosttester og én Playwright-maskeringstest i eksisterende browser-runner består. Første brede hostkommando manglet Playwright; riktig prosjekt-runner ble brukt uten global installasjon. Et mellomliggende workspace-build i testmiljø ga annen bundle; proveniensvakten avviste den, og QA-bygget ble gjenopprettet og sammenlignet med kanonisk image. Sluttbygget bruker QA-runnerens miljø og består igjen med identiske assets.

Den tidligere samlede monitor-testfeilen har ukjent rotårsak. Ingen produksjons-AI-logikk ble endret. Testen ble styrket med faktisk database/rad/blocker/waiter og uendrede null-wire-asserts. Fokusert test, diagnostiske repetisjoner og begge senere komplette retester består; den opprinnelige feilen er ikke kalt en bekreftet flake.

Første seks-personers UI-test avdekket to visuelle feil: svært lange navn ble brutt opp i mange fragmenter, og personkort viste et fiktivt klokkeslett for heldagshendelser. Rettet i `585a720`: bredere, balansert layout for lange navn og civil dato/heldagsmerking med eksklusiv kalender-sluttdato. Normale navn og tidsbestemte hendelser beholder tidligere layout/tidssonebehandling. Meningsfulle layout-, dato-, medlem- og displayregresjoner er lagt til.

**30 sluttkildebilder** er åpnet enkeltvis av UX-review og kontrollert for hash, dimensjon og kilde: [14 latest](latest/manifest.json) og [9 målrettede bilder](round-11/final-ui/manifest.json) og [7 EN/mørk-bilder](round-11/dark-ui/manifest.json). Ingen login/feilsider i basisbildene. De målrettede bildene viser administrator-dialoger uten hemmeligheter, mobile person-/leservalg, feil med beholdt innhold, gjenoppretting, seks lange navn og synlig «Hele dagen · tor. 22. okt. 2026». NB/EN, lys/mørk, desktop, mobil, iPad og Shelly er dekket. Primære designreferanser er uendret.

Den bevarte LAN-husstanden har fem personer; den er ikke erstattet. Hovedtesten bruker seks fiktive personer, to voksne og fire barn, i separate testdatabaser. [Innledende OAuth-/previewbilder](round-11/initial-flows/manifest.json) er ærlig merket kilde `1a10e77`, før de visuelle rettelsene. Backend-/kontrakttre er identiske mellom denne og sluttkilden. Slutt-UI har egen kilde `585a720` og separat fixture-seed-SHA; ingen gammel HEAD er registrert som ny UI-kilde.

Private browser-harnessforsøk traff feil i selectors, venting og gjentatt oppsett. Sluttrunden består. Enkelte tidligere extension-logger ble overskrevet av siste kjøring; de finnes i øktens toolhistorikk, ikke som separate råfiler. Rapporten påstår derfor ikke at alle mislykkede browserforsøk er filarkivert. Ingen tester ble svekket eller deaktivert.

## Backup, bevaring og offentlig kontroll

Fersk offentlig PG17-backup ble strømmet **lesende til lokal privat lagring**: 368 030 byte, SHA-256 `da02093071a116a573d3ab9a49585b17dd79c7749ca8d387fd0a0ee8cf03450e`. Faktisk isolert restore består med eksakt schema-24-ledger, migrasjon 025, andre kjøring uten endring, utvalgte opaque domene-/foto-/oppdrags-/kalender-/rettighetsinvariants, amcheck, kandidatens autentiserte syntetiske lesing og ti assets. Tidligere offentlig R10-image består autentisert lesing på schema 25 når ingen nye HA-rader finnes.

Klonekontrollen er intern HTTP-lesekompatibilitet, **ikke** offentlig HTTPS- eller virkelig providerverifikasjon. Ingen worker, vault, provider-/modellkall eller åpne porter i klonen. Alle midlertidige, eksakt merkede containere/nettverk/volumer er fjernet; backup og private bevis er bevart. Tidlige helperfeil (SQL, wildcard proxy, demo-flagg og endpoint) ble rettet i kontrollscriptet, ikke i offentlig oppsett. Runtimevaktene avviste ugyldig konfigurasjon som forventet. Den tidligere curl-forklaringen ble avkreftet og korrigert.

Separat faktisk HTTPS-kontroll av **uendret R10** består: health, avvisning av LAN `admin/admin`, eksisterende syntetisk konto inn/ut, Family Hub, Personer og Integrasjoner. Ingen eksterne requests, uventede API-skrivinger eller page errors. Dette er ikke bevis på at nye veivisere er offentlig tilgjengelige.

Beskyttet hoved-.git: 229 filer uendret. Tidligere reviewhistorikk: 621 filer og forrige latest 15 filer bevart; mellomrunden er også arkivert. 14 kontrollerte ordinære QA-domenetabeller og ni offentlige domenetabeller har uendrede full-JSON-hasher/counts. De to eksisterende private oppdragenes identiteter, godkjenninger, subjects/audits, mottakere og tidsplaner er uendret. Auth-sesjoner og naturlige worker-runtimefelt inngår ikke i påstanden om byte-like domenedata. Ingen manuell oppdragskjøring eller modellkall er utløst av pakken.

## Migrasjon og rollback

001–024 har uendrede checksummer. 025 er additiv og kjøres gjennom eksisterende ledger; ny tabell følger eksisterende databasebackup/vault. Offentlig DB er fortsatt schema 24 fordi kandidaten ikke er deployet.

Gammel kode kan ikke håndtere nye HA-rader eller GUI-registreringer. Før fremtidig image-rollback: stopp worker, fence HA/samtykke/leases etter 025/ADR 0023, vurder nye DB-registreringer mot gammel miljøkilde, og start gammel worker bare når kompatibiliteten er kontrollert. Klonens R10-lese-PASS gjelder dagens backup uten slike nye rader, ikke generell bakoverkompatibilitet for fremtidige tilkoblinger. Behold vault og schema/data; en gammel backup skal ikke automatisk overskrive nye brukerskrivinger. Se [ADR 0023](../../decisions/0023-calendar-registration-and-home-assistant.md).

## Konkret eierliste og testinnganger

Nye veivisere kan inspiseres i **syntetisk LAN-demo**, ikke brukes til å lagre offentlige kontoers hemmeligheter:

- [Google](http://192.168.0.220:4173/?tab=integrations&setup=google)
- [Microsoft](http://192.168.0.220:4173/?tab=integrations&setup=microsoft)
- [Spond/HA](http://192.168.0.220:4173/?tab=integrations&setup=spond)

Eierhandlingene for virkelig oppsett er:

1. Frigjør/utvid disk på **claude**, helst minst 2 GB ekstra, og bekreft kapasiteten. Ikke slett data/backuper/rollback-image. Allerede autorisert publisering kan deretter fortsette med ny kapasitets-/backupkontroll; ingen ny generell deploybekreftelse etterspørres.
2. **Etter publisering**, logg inn som faktisk installasjonsadministrator på [Google-oppsett](https://samvev.pabben.org/?tab=integrations&setup=google). Følg Google-konsoll-lenken, aktiver Calendar API, opprett Web application og kopier den eksakte offentlige returadressen fra veiviseren. Ved Testing: legg til nødvendige testbrukere. Last ned WEB-JSON og importer i det sikre skjemaet. Vanlige brukere velger deretter Google → Koble til → eget samtykke → kalendere → personer/lesere/skjermer → forhåndsvis → aktiver. GUI omgår ikke leverandørverifisering eller tokenutløp.
3. **Etter publisering**, åpne [Microsoft-oppsett](https://samvev.pabben.org/?tab=integrations&setup=microsoft). Følg Entra-lenken, registrer Web-returadresse og ønskede kontotyper. Legg Application/client-ID, hemmelighetens verdi og tenant (`common` for tillatte privat-/organisasjonskontoer) i administratorskjemaet. Organisasjonens administratorgodkjenning kan være nødvendig. Konto kobles og kalendere velges separat.
4. Oppgi eksisterende HA-adresse og autorisert tilgangsvei, **uten token/passord i chat**. Installasjonen er allerede bekreftet; ingen reinstallasjon. Etter publisering åpnes [Spond/HA](https://samvev.pabben.org/?tab=integrations&setup=spond): administrator setter eksakt eksisterende origin; familiemedlem bruker HA-nettleserinnlogging → velger faktisk Spond-kilde → kontrollerer identitet → person/lesere/skjermer → forhåndsvis → aktiver. Faktisk versjon/entiteter/cache/status må undersøkes gjennom denne autoriserte veien før live-PASS.
5. Tidligere ChatGPT-samtykke/privat import og lokal AI-eierkontroll er fortsatt egne, utestede eierpunkter fra [runde 9](ROUND_9_REPORT.md). Kalenderpakken oppretter ikke en ny AI-arkitektur eller kjører de eksisterende oppdragene.

De offentlige **nye** oppsettlenkene over venter på publisering. Ingen Google-/Microsoft-/HA-konto er faktisk autorisert eller synkronisert i denne pakken. Syntetisk PASS, registreringsstatus og faktisk live-PASS er separate bevis.

Åpent integrasjonsvalideringspunkt etter eget samtykke: kontroller en tidsbestemt hendelse, en heldag, en flerdagers heldag, en gjentakelse og en avlysning mot hver virkelig konto, inkludert annen kontotidssone. Microsofts [event-kontrakt](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0) krever midnatt og samme tidssone for heldagsgrenser; faktisk Graph-respons og kontokonfigurasjon må verifiseres, ikke utledes fra den injiserte fixturen. Kilden ble kontrollert 14. oktober 2026. HA krever i tillegg faktisk UID/registry-ID, cacheomfang, tilgjengelige forpliktelser og identitetskontroll; ingen generell live-PASS før disse er kontrollert.

## Endrede filer og reviewkommando

36 kilde-/test-/dokumentasjonsfiler er endret fra mailboxen; [filoversikten](round-11/checks/source-files.json) viser alle. I tillegg kommer denne rapporten, M1_STATUS, sanitized kontroller, screenshots og bevarte arkiver. [CALENDAR_CONNECTIONS.md](../../CALENDAR_CONNECTIONS.md), [HOME_ASSISTANT.md](../../HOME_ASSISTANT.md), arkitektur og ADR-er dokumenterer implementert funksjon og begrensninger.

Senere eksplisitte review-runder bruker eksisterende workflow: DCO-kildecheckpoint i publishing-checkout, `bash scripts/design-review-runtime.sh`, `bash scripts/design-review-build.sh`, så **`bash scripts/design-review.sh`**. Mailboxen auto-eksekveres ikke.

Ingen hemmelighet, privat personnavn eller privat kalenderdata er introdusert i Git eller reviewbilder. Ingen PR, merge, main-/force-push, tag/release eller Actions-dispatch. Offentlig utrulling av kandidaten er ikke utført.
