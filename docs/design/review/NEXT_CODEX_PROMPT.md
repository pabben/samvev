# Samvev – diskutvidelse, kalenderoversikt og fortløpende offentlig testpublisering

Utfør denne mailboxen når eieren starter den. Fortsett eksisterende `/goal` og nyere featurearbeid; ikke start runde 11 på nytt. Work har skrevet bestillingen, ikke utført serverendringer. Server-Codex gjennomfører den autonomt, med bevaring av data og nødvendige verifikasjoner. Omfanget er diskutvidelsen nedenfor, kalender-/Spond-forbedringene og de fortsatt relevante F1–F3-rettingene.

## Ny eierbeskjed 15. oktober 2026 og baseline

Eieren har lagt til 100 GB i Proxmox og ber uttrykkelig om gjesteutvidelse på **codex-dev**. Ferdige, verifiserte Samvev-oppdateringer skal fortløpende publiseres til **https://samvev.pabben.org/**. Dette er den offentlige testadressen; LAN alene er ikke ønsket sluttleveranse. Eieren har også opprettet en **reell HA-kobling for en person** og vil legge til flere Spond-kalendere som skal kunne fordeles på husstandens personer.

- Repo/branch: `pabben/samvev`, `feat/m3-family-hub`.
- Sist vurdert R11 source: `585a7204ce89bc7e953f6b79cf871c1845a12f9f`; review: `233239773019603b3d40bf12a4b4be51c6e6bc96`.
- Forrige oppfølgingsinstruks med F1–F3: `b2369629641c17cff0f4bed3e4c61dbbb3eba07f`.
- Historisk R11-kandidatimage: `sha256:5f63b1afb11d68aea1fdb8e1bc72cad2c099f1bab4377f7cc8aee6581d6eee12`.
- Sist rapporterte offentlige R10 source/deploy: `ca7359b0ce511f930aec3df0e11ce94ac4d203e6`. Verifiser nåværende status; ikke anta at ingen har arbeidet videre.
- LAN: http://192.168.0.220:4173/. Offentlig test: https://samvev.pabben.org/.

Les AGENTS, ROUND_11_REPORT, relevante `round-11/checks/`, review-README, produktkrav/arkitektur, CALENDAR_CONNECTIONS, HOME_ASSISTANT og ADR 0023. Hent nyere featurearbeid gjennom etablert publishing-checkout; ikke reset eller overskriv arbeid. Følg prosjektets parallelle lesende fagreview, én skriver om gangen, etterreview, samlet QA og release_gate sist. Siste uttrykkelige eierbeskjed går foran eldre generelle begrensninger innen det presise omfanget nedenfor.

Historisk R11-bevis: 351 tester, fem workspace check/build og fullt kanonisk build bestod. Work verifiserte hash/dimensjoner for 37 bilderegistreringer og alle 240 source-input-hasher, og åpnet et representativt bildeutvalg. Dette er ikke nye tester eller bevis på den kommende kandidatens drift. Publisert HTTPS-bevis gjaldt R10. F1–F3 er kode-/kontraktfunn, ikke feil fremprovosert i eierens livekontoer. Den nye opplysningen om ekte HA-bruk erstatter den gamle generelle antakelsen om manglende HA-tilkobling.

## 1. Utvid gjesteplassen på codex-dev

Begynn med avgrenset, lesende kontroll av vertsnavn/VM-identitet, faktisk diskstørrelse og ledig plass, partisjoner, eventuell LVM, filsystem og hvilke mounts som brukes av Samvev/Docker. Bruk relevante verktøy som `lsblk`, `findmnt`, `df` og LVM-visning der det faktisk brukes. Bekreft at tillegget finnes på riktig disk. Ikke gjett enhetsnavn eller partisjonsnummer.

Eieren autoriserer nødvendige administrative kommandoer, inkludert sudo ved behov, for å utvide den bekreftede eksisterende partisjon/PV/LV/filsystem-kjeden på **codex-dev** med den tilførte kapasiteten. Dette er et snevert unntak fra AGENTS' generelle forbud mot sudo og vertsendringer. Velg prosedyre etter faktisk oppsett; hvis plass allerede ligger ledig i riktig VG, skal ingen unødvendig partisjonsendring utføres. Bevar data, startsektorer, identiteter og mounts. Bruk støttet online-utvidelse når mulig. Ikke formater, krymp, bytt disk, endre andre VM-er eller utfør generell opprydding.

Dokumenter før/etter for blokkdevice, eventuell LVM og faktisk tilgjengelig filsystemplass, og kontroller app/database/worker etterpå. Hvis tillegget ikke er synlig, identiteten er tvetydig eller nødvendige privilegier mangler: ikke gjett; oppgi konkret blokkering og fortsett tilgjengelig applikasjonsarbeid.

**claude er et separat kontrollpunkt.** Den gamle offentlige deployblokkeringen ble målt der, med rundt 365 MiB ledig. Ekstra 100 GB på codex-dev løser ikke automatisk dette. Kontroller offentlig deploymål og fersk kapasitet separat. Denne autorisasjonen gir ikke lov til å utvide en annen VM eller disk.

## 2. Forsiden viser i dag og i morgen; persondetaljer viser fremover

Dagens `personalPreviewItems` i `apps/web/src/home-presentation.ts` avgrenser ikke dato, og personkort kan derfor vise en fjern fremtidig aktivitet. Listen er heller ikke en konsekvent kronologisk «neste aktivitet»-visning.

- Avgrens kalenderforhåndsvisningen på forsiden/personkortene til **I dag** og **I morgen**, tydelig merket etter husstandens tidssone. Senere aktiviteter skal ikke fylle et tomt felt for disse dagene.
- Vis en forståelig tomtilstand, for eksempel «Ingen aktiviteter i dag eller i morgen», og en tydelig vei til kommende aktiviteter. Eventuelle «X til»-tall skal telle innen samme datovindu.
- Bevar klikk på navn/bilde til eksisterende persondetaljer. Vis kommende aktiviteter kronologisk, gruppert etter dato, med klokkeslett eller «Hele dagen», relevant kilde og faktisk intervall ved flerdagshendelser. Senere datoer må være tilgjengelige ved vanlig scrolling; ikke avgrens detaljlisten til to dager. Opplys hvilken periode som er hentet hvis listen har et begrenset synkvindu.
- Respekter eksisterende leser-/displayrettigheter før visning og opptelling. Personkobling er ikke en rettighetstildeling. Bevar relevante oppdrag, varsler og resultater; ikke bruk kalenderfilteret til å skjule alt annet innhold på kortet.
- Håndter lokale døgn, midnatt og sommertid, pågående og flerdagshendelser, heldag med eksklusiv sluttdato, kanselleringer og utdatert kilde. Bruk husstandens konfigurerte tidssone; test Europe/Oslo. Datovinduet er presentasjon, ikke forkorting/sletting av providerens hentede fremtidige data.
- Bruk isolerte, fiktive data: sett dato til 15. oktober og legg en aktivitet 24. oktober. Den skal finnes i kommende-listen, men ikke på dagens/morgendagens kort; på den 23. vises den under I morgen, og den 24. under I dag. Kontroller automatisk døgnskifte uten tvungen full omlasting.
- Kontroller seks fiktive personer, to voksne og fire barn, på mobil, iPad, kompakt Shelly-panel og desktop, i lys/mørk. Datoer og lange navn skal være lesbare. Bevar en praktisk mobilvisning og eksisterende dagsplan.

## 3. Flere HA/Spond-kalendere og bevaring av den reelle koblingen

Finn først gjennom eksisterende, avgrenset privat tilgang hvilket Samvev-miljø den reelle HA-koblingen ligger i. Bevar tokens/vault, konto, stabile registry-/kildeidentiteter, personkoblinger, leser-/displayvalg, hendelser og synkhistorikk. Ikke behandle ordinær LAN-installasjon som disponibel syntetisk testdata; ingen reseed, reset eller frakobling for QA.

Lever en forståelig flyt på **eksisterende tilkobling**:
«Oppdater kalenderliste» → velg kalender → «Gjelder hvem?» → separate valg for lesere/skjermer → forhåndsvis daterte aktiviteter → aktiver.

- Oppdag nye Spond-kalendere som eieren legger til i samme godkjente HA, uten å opprette ny kontotilkobling eller kreve ny innlogging hver gang. Kalenderliste-oppdatering og vanlig hendelsessynk skal ha forskjellige, forståelige navn.
- Støtt flere kalendere til én person, forskjellige kalendere til forskjellige personer og en felles kalender til flere uttrykkelig valgte personer. Ikke koble automatisk etter navn eller opprett husstandsmedlemmer fra HA.
- Bevar eksisterende valg ved ny discovery, omstart og endret entity-ID med samme stabile registry-ID. Nye kilder er inaktive til uttrykkelig person-/synlighetsvalg, forhåndsvisning og aktivering. Manglende/utilgjengelige kilder varsles uten automatisk sletting eller omkobling.
- Endret personfordeling skal oppdatere de riktige kortene/detaljlistene og fjerne gammel tilknytning uten å slette kildehistorikk eller duplisere hendelser. Bevar eksisterende kontroll mot samme kilde via flere importveier; ikke slå sammen ulike aktiviteter bare fordi titlene ligner.
- Test kilde A/person A, kilde B/person B, flere kilder til samme person, delt kilde, omfordeling, ny discovery, rename, midlertidig manglende kilde og lesergrenser.
- Den eksisterende autoriserte koblingen kan brukes til skånsom, avgrenset verifikasjon av valgte kilder. Ikke fremprovoser feil i ekte HA; feil/recovery testes isolert. Ingen nettverksskanning, HA-reinstallasjon, Spond Tracker-endring eller generell dump av tilstander.
- Hvis koblingen ligger på LAN, avklar en støttet, kontobundet vei til offentlig test uten tap av eksisterende valg. Ikke kopier vault-hemmeligheter blindt mellom installasjoner. Hvis nytt samtykke faktisk kreves, ferdigstill og publiser funksjonene og gi én konkret GUI-handling for eieren. Ikke be om allerede registrert HA-adresse/tilgang på nytt uten å kontrollere eksisterende privat konfigurasjon.
- Ingen ekte navn, kalenderinnhold, kildeidentifikatorer, hemmeligheter eller personkoblinger i GitHub, offentlige screenshots eller rapporter. Bruk syntetiske fixtures og valider personvernmasker før publisering.

## Tidligere bestilte rettinger – bevar F1–F3

Kontroller om nyere featurearbeid allerede har løst funnene. Verifiser og behold ferdige rettinger; implementer bare det som mangler.

## F1. Gjenoppta synk etter reparert klienthemmelighet

`calendar/service.ts:syncConnection` setter `state=error`, `last_error_code=CALENDAR_CLIENT_CONFIGURATION_INVALID` og `next_sync_at=NULL` ved ugyldig klientkonfigurasjon. `calendar/provider-config.ts:update` bevarer disse feltene ved lagring med samme client-ID; den oppdaterer bare registreringsbinding/generation/lease. Worker velger aldri NULL-tiden, og UI fortsetter å blokkere vanlig oppdatering på den gamle klientfeilen.

Reproduser: aktiv kalender → refresh gir `invalid_client` → administrator lagrer rettet hemmelighet med samme client-ID → synk forblir stoppet. Dagens rotasjonstest dekker bare en frisk connected-tilstand.

Rett denne gjenopprettingsbanen. Lagring av reparert registrering skal gjøre et nytt ordinært synkforsøk mulig for fortsatt autoriserte, aktiverte kilder med bevart kontotilgang. Ikke krev nytt brukersamtykke bare fordi samme klients hemmelighet er fornyet. Ikke merk autentisering/synk som verifisert før forsøket faktisk lykkes; behold utdatert-status og siste vellykkede tidspunkt frem til da.

Test både Google/Microsoft, fortsatt feil hemmelighet, ingen aktive kilder, uttrykkelig pause/frakobling, tilbakekalt eiermyndighet og et gammelt pågående forsøk. Bevar retry-stopp ved fortsatt klientfeil, tokens, kildeidentitet, normale tidsplaner og generation-/lease-vern. Ingen utilsiktet aktivering av andre kalendere.

## F2. Håndter bytte av Microsoft-appregistrering uten fastlåst kontobinding

`DefaultCalendarTransport.exchangeCode` bruker Microsoft UserInfo-`sub`. Registreringsbytte til ny client-ID krever nytt samtykke, men `provider-config.ts:update` beholder gammel `provider_subject_hash`; `completeOAuth` avviser deretter en annen hash.

Microsoft dokumenterer at samme bruker får forskjellig `sub` for forskjellige client-ID-er, og at UserInfo bruker de samme claim-verdiene som ID-tokenet. Dermed kan den samme kontoen ikke fullføre ny innlogging på eksisterende tilkobling etter et legitimt appbytte.

Lever en eksplisitt, sikker GUI-vei for dette tilfellet. Enten verifiser samme uforanderlige konto med dokumentert identitetsgrunnlag på tvers av klientene, eller gjør nødvendig ny tilkobling til en tydelig, gjennomførbar eierhandling. «Koble til på nytt» skal ikke sende brukeren rundt i en permanent feilsløyfe. Velg minste riktige løsning og dokumenter konsekvensene.

Ikke fjern hashkontrollen generelt, nullstill binding blindt, bruk e-post/visningsnavn som sikker identitet eller overfør gamle kilde-/delingsvalg automatisk til en vilkårlig konto. Bevar historikk og data; eventuell erstatning av gammel tilkobling må være uttrykkelig og følge eksisterende frakoblings-/preview-/aktiveringsregler. Gamle callbacks og feil konto skal fortsatt avvises.

Test med realistisk transport der samme Microsoft-konto gir sub A under klient A og sub B under klient B, samt en faktisk annen konto, samme-client secret-rotasjon og gammel consent-generation. Vis den valgte løsningen gjennom UI. Kontroller at kildevalg og leser-/displayrettigheter ikke videreføres uten gyldig kontobinding og nødvendig godkjenning.

Primærkilder kontrollert 15. oktober 2026:
- https://learn.microsoft.com/en-us/entra/identity-platform/userinfo
- https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference

## F3. Spond-kildehelse må kontrolleres selv om HA svarer HTTP 200

`home-assistant-client.ts:listEvents` sjekker registry-identitet og kalenderrespons, men ikke den valgte entitetens tilgjengelighet. Ved Spond-hentefeil kan trackerens coordinator beholde gammel cache samtidig som entiteten blir unavailable. Trackerens `async_get_events` leser fortsatt cachen, og HAs kalender-REST kan returnere den med HTTP 200. Samvev avstemmer deretter som suksess og oppdaterer freshness/last_sync_succeeded_at.

Reproduser isolert: gyldig første Spond-snapshot → Spond-henting feiler mens HA fortsatt svarer → HA returnerer gammel kalendercache og entiteten er unavailable → Samvev skal beholde innholdet som utdatert, ikke friskmelde det.

Kontroller helsen til akkurat den valgte Spond-entiteten gjennom et avgrenset lesekall mot allerede godkjent HA-origin. Utilgjengelig eller ukjent kildehelse skal ikke godkjennes som et nytt fullstendig snapshot. Bevar siste gyldige innhold og tidspunkt, vis forståelig utdatert-status og gjenoppta normalt når kilden er frisk. Et vanlig kalender-state `off` betyr ikke utilgjengelig; frisk og faktisk tom kalender må fortsatt kunne avstemmes korrekt.

Test unavailable/unknown kombinert med HTTP 200 og gammel cache, utilgjengelig kilde med tom respons, frisk tom kalender, gjenoppretting og endret entity-ID med samme registry-ID. Bevar DNS-pinning, tids-/responsgrenser og tilgangsfiltrering. Ikke hent en generell dump av alle HA-tilstander, endre HA eller utvid til andre instanser.

Versjonsfestet primærkode:
- https://github.com/agjendem/ha-spond-tracker/blob/0d8efdd06cf39763807cec0fc114fbdaa6bf87a6/custom_components/spond_tracker/coordinator.py
- https://github.com/agjendem/ha-spond-tracker/blob/0d8efdd06cf39763807cec0fc114fbdaa6bf87a6/custom_components/spond_tracker/calendar.py
- https://github.com/home-assistant/core/blob/5109b1dbae64a37e3431ba6dc52764aeb98c1ccf/homeassistant/helpers/update_coordinator.py
- https://github.com/home-assistant/core/blob/5109b1dbae64a37e3431ba6dc52764aeb98c1ccf/homeassistant/components/calendar/__init__.py

Dette er referansekontrakter, ikke bevis på eierens installerte versjon.

## 4. Fortløpende offentlig testpublisering

Offentlig test er normal leveransekanal fra nå av. Publiser ferdige, sammenhengende og verifiserte endringer til https://samvev.pabben.org/ gjennom etablert Samvev SSH-/Compose-vei, uten å spørre om generell publiseringstillatelse igjen. LAN er et mellomsteg for QA. Ikke meld ferdig med bare LAN dersom offentlig deploy kan gjennomføres.

Mål kapasitet på faktisk offentlig mål for den nye kandidaten, med utpakking, database/migrasjon og recoverymargin; en gammel tommelfingerregel om 2 GB er ikke et målt deploykrav. Ikke gjenta tunge forsøk på full disk. Bevar databaser, volumer, vault, backuper og fungerende rollback-image. Ingen bred prune, andre prosjekter eller uautorisert utvidelse av claude. Eventuell opprydding begrenses til entydig gjenoppbyggbare Samvev-artefakter innen eksisterende tillatelser. En faktisk gjenværende claude-blokkering skal beskrives konkret etter at resten er ferdigstilt.

Kontroller fersk backup og nødvendig isolert restore for faktisk kandidat/migrasjon. Gjenbruk gyldig bevis bare der forutsetningene er uendret. Gammel R10-lesekompatibilitet uten HA-/GUI-rader er ikke generell rollbackgodkjenning etter reelle brukeroppsett. Følg ADR 0023 og bevar nyere data fremfor automatisk restore over nye skrivinger. Ingen unødvendige driftsavbrudd eller endringer i andre tjenester.

## Verifikasjon, bevaring og leveranse

- Reproduser og rett gjenværende F1–F3 med isolerte regresjonstester som avslører baselinefeilene. Test de nye kalenderflytene målrettet, og gjennomfør prosjektets nødvendige samlede retest og etterreview. Skill syntetisk leverandørtest fra faktisk verifisert HA-synk.
- Bevar migrasjoner 001–025 og checksummer; bare nødvendige additive endringer. Bevar personkoblede AI-oppdrag, godkjenninger, mottakere, subjects, historikk og tidsplaner. Ingen manuell livekjøring, kopier, betalt fallback eller nye AI-samtykker/importer som QA-verktøy.
- Bevar reelle data/rettigheter/profilbilder, beskyttet hoved-.git, eksisterende husstandsmedlemmer, LANs `admin/admin` og begge ordinære miljøer. Test skrive-/feilscenarioer i isolerte testdatabaser.
- Ny applikasjonskilde krever nytt DCO-kildecheckpoint, kanonisk immutable build og kildebundet runtime/capture. Regenerer 14 latest gjennom etablert rutine med kontrollerte personvernmasker. Suppler målrettet hjem/persondetaljer, kildeoppdatering/personfordeling og berørte recovery-/registreringsflyter i NB/EN, lys/mørk og relevante skjermstørrelser. Bruk seks fiktive personer; ingen ny generell bildematrise.
- Tidligere enkeltbilde `round-11/final-ui/calendar-recovery-nb-light.png` hadde blank Google-secondary-knapp, mens samme kontroll hadde tekst i kode og stale-bildet. Kontroller ved recapture; rett hvis avviket gjenskapes. Ikke rapporter det som allerede bekreftet funksjonsfeil.
- Etter faktisk deploy: verifiser kandidatens image/source/schema, app/worker/database, HTTPS-inn-/utlogging, kalenderkort/detaljer, veivisere, tilgangsgrenser og SSE. Oppgi separat hva som er prøvd mot ekte HA og hva som fortsatt krever Google-/Microsoft-samtykke. Gamle R10-kontroller er ikke etterkontroll av ny kandidat.
- Oppdater relevant krav-/driftsdokumentasjon og M1_STATUS. Lever ny oppfølgingsrapport med source/review/deploy-SHA, round ID, endrede filer, tester, F1–F3, kalenderkrav, codex-dev før/etter-kapasitet, separat claude-kapasitet og recovery-/rollbackstatus. Bevar historiske rapporter/bilder med riktig kilde.
- Samle bare faktisk gjenstående eierhandlinger i én kort liste: eventuell dokumentert kapasitet/tilgang som fortsatt blokkerer, og konkrete GUI-samtykker som ikke kan gjenbrukes. Ikke be om passord, tokens eller nøkkelinnhold i chat. Tidligere ChatGPT-samtykke/import og lokal AI er fortsatt egne restpunkter.

Fortsett autonomt med alle tilgjengelige deler selv om én ekstern avhengighet blokkerer resten. Ikke stopp ved plan, første retting eller LAN-publisering. Avslutt når omfanget er dokumentert ferdig, eksisterende goal-budsjett er brukt opp eller alle gjenværende veier faktisk krever eier. Ikke opprett ny betalt kapasitet eller endre et budsjett på egen hånd.

DCO-signert push bare til `feat/m3-family-hub`. Ingen PR, merge, main-/force-push, tag/release eller Actions-dispatch. De uttrykkelig autoriserte unntakene er gjesteutvidelsen på codex-dev og offentlig Samvev-testpublisering som beskrevet over.
