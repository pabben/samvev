# Samvev – samlet implementeringsprompt: kalender-GUI og Spond via Home Assistant

Utfør denne mailboxen eksplisitt når eieren ber om det. Ikke auto-eksekver ved lesing. Dette er neste avgrensede implementeringspakke etter fullført runde 10, ikke en generell designrunde. Implementer og test faktisk; en mulighetsvurdering alene oppfyller ikke bestillingen.

## Baseline og arbeidsflyt

Repo `pabben/samvev`, featurebranch `feat/m3-family-hub`, arbeidsområde `/home/administrator/apper/samvev`. Fullført runde 10 source/deploy: `ca7359b0ce511f930aec3df0e11ce94ac4d203e6`; review: `39c7e7c06475a7d8e4a35d9750a249b31baf74d3`; round ID `20261014094940-ca7359b0-428c5403`. Offentlig test: https://samvev.pabben.org/. LAN: http://192.168.0.220:4173/.

Hent siste featurebranch gjennom `.local/design-review-publish`; kontroller gren, status, samtidige agenter og nyere arbeid før endring. Bevar arbeid og beskyttet hoved-.git; ikke bruk gammel hoved-HEAD som ny UI-kilde. Les AGENTS, README, produktkrav, arkitektur, relevante ADR-er, `docs/CALENDAR_CONNECTIONS.md`, `docs/HOME_ASSISTANT.md`, ADR 0022, review-README, ROUND_9_REPORT, ROUND_10_REPORT og gjeldende deploy-/recovery-bevis. Følg prosjektets fagreview: første lesende reviews parallelt, én skriver om gangen, security/requirements/UX etterreview, full QA og release gate sist. Ikke start parallelle eller konkurrerende integrasjonsarkitekturer.

Runde 9/10 har allerede Google/Microsoft OAuth, PKCE/sesjonsbundet callback, krypterte tokens, ICS, kalendervalg, subjects/lesere/displays, forhåndsvisning, aktivering, fullsnapshot og synkstatus. Runde 10 rettet metadata, gjenopptak etter samtykke, tokenfeil, oppdragsstatus og stabil paginering; bevar disse regresjonstestene. Administratorregistrering bruker fortsatt miljøkonfigurasjon. Spond-broen bruker foreløpig Google/Outlook; det er ikke den ønskede primærveien. HA-dokumentasjonen er ikke bevis på implementert eller live tilkobling. Verifiser dagens kode før utvidelse.

## 1. Direkte Google og Outlook – vanlig bruker

Lever flyten Integrasjoner → Google Kalender / Outlook → Koble til → leverandørens innlogging/samtykke → velg kalendere → personer og synlighet → forhåndsvis → aktiver. Ingen client-ID, klienthemmelighet, YAML eller serverkonfigurasjon i familiemedlemmets flyt. HA skal ikke være nødvendig.

Støtt flere kontoer og kalendere uten sammenblanding. Skill kontoeier, hvem kalenderen gjelder, lesere og skjermer. Kobling til et barn gir ingen automatisk familie-/displaydeling. Vis oppdatering, ny innlogging, frakobling, faktisk synkstatus og siste vellykkede oppdatering. Bare lesing: ingen endringer, invitasjoner eller svar hos leverandørene.

## 2. Egen administratorveiviser

Skill installasjonsadministrator fra vanlig husstandsadministrator og medlem; håndhev riktig tilgang server-side. Ikke gi alle familiemanagere installasjonsomfattende hemmelighetstilgang. Gjenbruk eksisterende autoritetsmodell, eller dokumenter/test nødvendig avgrenset tillegg.

Vis Google/Microsoft konfigurasjonsstatus, offisielle registreringsinnganger, korrekt returadresse med kopieringsknapp, nødvendige leserettigheter og kontotyper. Tilby validert import av Googles nedlastede WEB OAuth-konfigurasjonsfil og manuell alternativregistrering. Microsoft får sikkert skjema for nødvendige registreringsverdier. Avvis feil klienttype/returadresse og uventede/for store filer uten rå innhold i logger.

Lagre hemmeligheter kryptert server-side med eksisterende vault, aldri tilbake i API/UI; app og worker skal bruke samme autoritative konfigurasjon. Gjenbruk allerede konfigurert registrering. Lag eksplisitt overgang/precedens og rollback fra eksisterende miljøverdier; ikke behold to konkurrerende konfigurasjonskilder eller rediger .env automatisk uten sikker plan. Audit uten hemmeligheter; test adgang, CSRF, secret-rotasjon og restart.

Skill «Appregistrering mangler», «Appen er konfigurert», «Konto er tilkoblet» og «Kalendersynk er kontrollert». Utfylt skjema eller syntetisk test betyr ikke live konto. Kontroller gjeldende Google-krav til testmodus, refresh-tokenutløp og verifisering mot offisielle kilder med dato. Microsoft skal støtte private og jobb-/skolekontoer når registrering og organisasjon tillater det. GUI kan ikke omgå ekstern registrering, samtykke eller administratorgodkjenning.

## 3. Spond → Home Assistant → Samvev

Spond Tracker https://github.com/agjendem/ha-spond-tracker er allerede installert i eierens HA, bekreftet av eieren. Ikke be om reinstallasjon. Eieren ønsker dette uavhengig av Samvev. Primærvei er HA direkte, uten Google/Outlook som mellomledd; eksisterende kalenderbro kan beholdes tydelig som alternativ.

Lever Integrasjoner → Spond → Via Home Assistant → Koble til → velg datakilder/personer → forhåndsvis → aktiver. Undersøk faktisk HA-instans og installert versjon/datatilgang/entiteter gjennom tilgjengelig autorisert tilgang og lokal dokumentasjon; ikke gjett adresse, entitetsnavn eller identiteter. Ikke gjør bredt nettverkssøk. Gjenbruk eksisterende HA-tilkobling om den finnes.

Undersøk og implementer HA-nettleserautorisasjon der autorisert nettverksvei og HA-kontrakten gjør det mulig. Langlivet tokenkopiering skal ikke være normal brukeropplevelse. Dokumenter faktisk tokenrettighet: Samvev-entitetsfiltrering begrenser ikke nødvendigvis HA-tokenets rettigheter. Sikre URL/redirect/SSRF mot den uttrykkelig autoriserte instansen; ikke åpne generell tilgang til private nett.

Spond-passord skal aldri inn i Samvev. Ingen offentlig eksponering av HA, Pangolin-endring eller svekket nettverksvern. Ikke reinstallér, endre automasjoner eller restart HA uten konkret behov og nødvendig godkjenning. Hvis tilgang mangler, fullfør adapter/GUI/testforberedelser og spør bare etter konkret nødvendig tilgang, aldri hemmeligheter i chat.

## 4. Importkontrakt og personvern

Undersøk trackerens faktiske strukturerte data, tidsromsinnhenting og endringshendelser fra installert versjon og primærkilder. Hent relevante arrangementer og tilgjengelige oppgaver/forpliktelser, eksempelvis kjøring/dugnad. Ikke baser komplett import på «neste hendelse» eller en kort sensorliste. Hvis faktisk tracker/API ikke leverer et komplett vindu eller oppgaver, implementer bare dokumentert tilgjengelig funksjon og vis presis begrensning; ikke fabriker støtte.

Bruk stabile kilde-, person- og hendelsesidentifikatorer der tilgjengelig. Eksplisitt kontrollerbar personkobling, aldri automatisk fornavnsmatching. Kildesammenblanding skal synliggjøres og avklares. Bevar forskjell mellom avlyst, avslått, ubesvart og foreløpig. Ingen automatiske AI-oppdrag, poengoppgaver eller påmeldinger; ingen accept/decline-tjenester eller annen tilbakeføring til Spond. Ingen løfte om chat, innboks eller vedlegg uten implementert/testet støtte.

Full innhenting ved oppstart og gjenoppretting; endringshendelser bare supplement. Gjentatt synk må være idempotent. Samme arrangement via HA og Google/Outlook krever sikker ekstern identitet eller uttrykkelig kildevalg; ikke fuzzy sammenslåing på tittel/tid. Bruk eksisterende snapshot-, lease-, revision-, tombstone- og tilgangsmodell.

Overfør minimum nødvendig data, ikke øvrige deltaker-/medlemslister til familiens skjermer. Ved feil behold siste gyldige innhold med utdatert-status; feil er ikke tom kalender. Frakobling stopper hentinger og følger eksisterende importtilbaketrekkingsregler, uten sletting av egne Samvev-avtaler.

## 5. Design, tester og kildebevis

Bevar gjeldende design og primærreferansene `docs/design/ChatGPT Image 24. sep. 2026, 23_51_09.png` og `docs/design/ChatGPT Image 24. sep. 2026, 23_52_06 (4).png`. NB/EN, tilgjengelighet, lys/mørk, mobil/iPad/stor skjerm/Shelly. Ingen separat teknisk adminstil. Test lange navn, tomt, feil og seks fiktive personer (2 voksne/4 barn) isolert; ikke opprett/erstatt virkelige personer.

Automatiser bruker-/installasjonsadmin-/barn-/displaygrenser, OAuth-avbrudd/feil/utløp/frakobling, konto-/kalenderisolasjon, person-/privat-/deltvisning, tidssoner, heldag, gjentakelser, avlysninger, gjentatt synk, duplikater og gjenoppretting etter nedetid. Test tokenrettigheter, hemmelighetslagring, konfigurasjonskildemigrering, HA-urlvern og feilstatus. Ingen tester mot vanlig QA eller offentlig DB. Ingen modellkall, manuell oppdragskjøring eller endret godkjent tidsplan som testverktøy.

Fullfør relevant samlet retest/check/build og kanonisk immutable finalbygg. Kildefiler, QA runtime og manifest sourceSHA skal samsvare med faktisk kildecheckpoint, ikke beskyttet gammel HEAD. Kjør `bash scripts/design-review.sh`, verifiser alle 14 latest-bilder og suppler målrettet nye veivisere/person-/feilflyter. Screenshots skal vise ekte UI, ikke login/feilsider; maskert syntetisk innhold, ingen private navn eller kalenderdata. Bevar tidligere arkiv og bevis.

## 6. Autorisert testpublisering og ferdigkrav

Testpublisering til https://samvev.pabben.org/ er allerede autorisert. Bevar data, offentlige kontoer/konfigurasjon/secrets/vault/porter og LAN admin/admin. Bruk bekreftet etablert SSH-/Compose-/backup-/restore-/rollbackvei, kun prosjekt samvev-m1, ingen andre prosjekter/globalendringer. Ny kapasitetskontroll før tungt bygg/transfer/restore: runde 10 etterlot begrenset diskmargin. Ingen brede prune eller sletting av data/backuper/rollback-images.

Bevar migrationschecksummer; eventuelle tillegg er additive/idempotente. Verifiser fersk backup i isolert restore, kandidat og faktisk gammel-kodekompatibilitet der rollback krever det, kilde-/imageidentitet, app/worker/DB og faktisk HTTPS-innlogging/navigasjon/tilgang/SSE. Bevar to eksisterende personkoblede oppdrag, identiteter, godkjenninger, mottakere og tidsplaner uten kopier/modellkall. Rapporter naturlig bakgrunnsaktivitet separat.

Fullfør alt uten personlig innlogging/leverandørgodkjenning. Ett ventende samtykke blokkerer ikke resten. Liveundersøk HA bare gjennom autorisert tilgang; Google/Microsoft kontrolleres med ekte samtykke når tilgjengelig. Skill implementert, syntetisk test, faktisk kontoautorisering og faktisk synkroniserte data – ingen live-PASS på syntetisk grunnlag.

Oppdater CALENDAR_CONNECTIONS, HOME_ASSISTANT, relevant ADR/driftsdokumentasjon og M1_STATUS; lag samlet leveranserapport med endrede filer, tester, migrasjon/rollback, kilde/deploy/reviewSHA, roundID, manifest og direkte GUI-lenker. Samle konkrete gjenstående eierhandlinger i én GUI-sjekkliste med hvor/hva, aldri hemmeligheter i chat. Tidligere utestet ChatGPT-samtykke/import og lokalAI-eierkontroll beholdes som tydelig restpunkt; ikke start en ny AI-arkitektur eller endre oppdrag for kalenderpakken.

DCO-signert commit/push kun featurebranch. Ingen PR, merge, main-/force-push, tag/release eller Actions-dispatch. Fortsett implementering, fagreview, feilretting, tester, visuell iterasjon og tilgjengelig publisering til dokumentert ferdig, budsjettgrense eller alle gjenværende veier faktisk trenger eier. Ikke stopp ved vurdering eller plan.
