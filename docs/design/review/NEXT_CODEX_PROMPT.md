# Samvev – sluttføring av runde 11: tre rettinger og testpublisering

Utfør denne mailboxen når eieren starter den. Fortsett eksisterende `/goal` og bevar runde 11. Work har bare skrevet oppfølgingen; server-Codex retter, tester og publiserer. Dette er avgrenset sluttføring av kalender-/Spond-pakken, ikke en ny generell funksjons- eller designrunde.

## Baseline og review

- Repo/branch: `pabben/samvev`, `feat/m3-family-hub`.
- Vurdert R11 source: `585a7204ce89bc7e953f6b79cf871c1845a12f9f`.
- Vurdert R11 review: `233239773019603b3d40bf12a4b4be51c6e6bc96`.
- Kandidatimage: `sha256:5f63b1afb11d68aea1fdb8e1bc72cad2c099f1bab4377f7cc8aee6581d6eee12`.
- Screenshot-runde: `20261014223031-585a7204-59693e69`.
- Faktisk offentlig R10 source/deploy: `ca7359b0ce511f930aec3df0e11ce94ac4d203e6`, fortsatt uendret.
- LAN: http://192.168.0.220:4173/. Offentlig test: https://samvev.pabben.org/.

Les AGENTS, ROUND_11_REPORT, `round-11/checks/`, review-README, gjeldende produktkrav/arkitektur, CALENDAR_CONNECTIONS, HOME_ASSISTANT og ADR 0023. Hent nyere featurearbeid gjennom etablert publishing-checkout; ikke reset eller overskriv arbeid. Følg prosjektets parallelle lesende fagreview, én skriver om gangen, etterreview, samlet QA og release_gate sist.

Work har bekreftet hash og dimensjoner for 37 bilderegistreringer, hvorav 30 fra sluttkilden, og alle 240 source-input-hasher. Et representativt visuelt utvalg er faktisk åpnet; ikke skriv at Work åpnet alle latest-bildene eller omkjørte serverkontroller. Ingen bekreftet materiell visuell regresjon i utvalget. Serverens 351 tester, fem workspace check/build og fullt kanonisk R11-build er dokumentert bestått. R9s gamle overlaybegrensning gjelder ikke dette bygget.

Publisert HTTPS-bevis gjelder R10. Nye veivisere finnes på LAN, men ingen ekte Google-, Microsoft- eller HA-synk er verifisert. De tre P2-funnene under er bekreftet gjennom kode og relevante primærkontrakter, ikke gjennom eierens livekontoer.

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

## Diskplass og allerede autorisert testpublisering

Siste rapporterte måling på claude var 382 885 888 byte ledig (365,15 MiB). Manglende komprimerte imagelag pluss beholdt 300 MiB recoverymargin krevde minst 442 283 862 byte. Underskuddet var 56,65 MiB allerede før Docker-utpakking/metadata. Å frigjøre bare dette underskuddet er derfor ikke tilstrekkelig grunnlag. Rapportens minst 2 GB ekstra er en foreslått arbeidsmargin, ikke et målt eksakt deploykrav.

Gjør ny kapasitetskontroll og beregn behov for den rettede kandidaten. Ikke gjenta tunge forsøk på full disk. Bevar databaser, volumer, backuper, vault og R10-rollback-image. Ingen bred prune, global opprydding, inngrep i andre prosjekter, partisjons-/VM-endring eller ny generell driftsautorisasjon utledet av denne prompten. Identifiser eventuelt entydig gjenoppbyggbare Samvev-artefakter innen eksisterende tillatelser. Hvis større kapasitet krever eier: fullfør rettinger/test/build/dokumentasjon først og oppgi konkret gjenstående tiltak.

Publisering er allerede autorisert når kapasitet og øvrige driftsvilkår er oppfylt. Bruk etablert Samvev SSH-/Compose-vei, fersk backupkontroll og nødvendig isolert restore for faktisk kandidat/migrasjon. Gjenbruk gyldig R11-recoverybevis der forutsetningene er uendret; dokumenter avgrensningen. Gammel R10-lesekompatibilitet uten HA-/GUI-rader er ikke generell rollbackgodkjenning etter nye brukeroppsett. Følg ADR 0023 og behold data fremfor automatisk restore over nyere skrivinger.

## Verifikasjon, bevaring og leveranse

- Reproduser og rett F1–F3 med meningsfulle isolerte regresjonstester; de nye testene skal avsløre baselinefeilene. Gjennomfør prosjektets nødvendige samlede retest og etterreview. Ingen ekstern konto eller live modellkall er nødvendig for rettingene.
- Bevar migrasjoner 001–025 og checksummer. Bare nødvendige additive endringer. Bevar de to eksisterende personkoblede oppdragene, godkjenninger, mottakere, subjects, historikk og tidsplaner. Ingen manuell livekjøring, tolking, kopier, betalt fallback eller nye samtykker/importer som QA-verktøy.
- Bevar reelle data/rettigheter/profilbilder, beskyttet hoved-.git, LANs fem personer og `admin/admin`. Test bare i isolerte testdatabaser. Begge ordinære miljøer skal fortsatt kjøre.
- Ny applikasjonskilde krever nytt DCO-kildecheckpoint, kanonisk immutable build og kildebundet runtime/capture. Regenerer 14 latest gjennom etablert rutine/personvernmasker, og suppler målrettet de berørte recovery-/registreringsflytene i NB/EN, lys/mørk og mobil/større skjerm. Seks fiktive personer er hovedfixture; ingen ny generell bildematrise.
- Ett enkelt bildeavvik er observert: `round-11/final-ui/calendar-recovery-nb-light.png` har blank knapp ved Google secondary, mens samme kontroll har riktig tekst i stale-bildet fra samme kilde og i kode. Kontroller denne knappen ved målrettet recapture; rett bare hvis avviket faktisk gjenskapes. Ingen bekreftet funksjonsfeil er utledet av bildet alene.
- Etter faktisk deploy: kontroller kandidatens image/source/schema, app/worker/database, HTTPS-inn-/utlogging, nye veivisere, tilgangsgrenser og SSE. Skill dette fra syntetisk providersynk og fortsatt manglende ekte kontoautorisering. Offentlig R10-kontroll kan ikke gjenbrukes som kandidatens etterkontroll.
- Oppgi eksplisitt source/review/deploy-SHA, round ID, endrede filer, tester, F1–F3-resultat, kapasitets-/recovery-/rollbackstatus og direkte lenker i en ny oppfølgingsrapport. Bevar historiske rapporter og bilder med riktig kilde.
- Samle én kort eierliste: nødvendig plass på claude; eksisterende HA-adresse/tilgangsvei uten hemmeligheter; etter publisering leverandørregistrering/samtykke via offentlig GUI. Ikke gjett HA-adresse fra tidligere planer, skann nettverket eller reinstallér eksisterende Spond Tracker. Ekte hemmeligheter skal ikke legges i syntetisk LAN-demo eller chat. Tidligere ChatGPT-samtykke/import og lokal AI er fortsatt egne restpunkter.

Fortsett autonomt med alle tilgjengelige deler selv om diskplass eller eierens kontoer blokkerer resten. Ikke stopp ved en plan eller første retting; avslutt når omfanget er dokumentert ferdig, budsjettgrensen nås eller gjenværende veier faktisk krever eier. DCO-signert push bare til `feat/m3-family-hub`. Ingen PR, merge, main-/force-push, tag/release eller Actions-dispatch.
