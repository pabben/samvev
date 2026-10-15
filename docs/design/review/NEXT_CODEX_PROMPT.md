# Samvev – avgrenset oppfølging etter publisert runde 12

Utfør denne mailboxen når eieren starter den i eksisterende Codex-økt. Bevar publisert runde 12 og nyere featurearbeid. Den tidligere bestillingen er levert; dette er tre konkrete temperaturrettinger, ikke en ny generell design-/integrasjonsrunde. Work endrer bare denne instruksen; server-Codex reproduserer, retter, tester og publiserer.

## Baseline og hva som allerede er ferdig

- Repo/branch: `pabben/samvev`, `feat/m3-family-hub`.
- Vurdert og rapportert deployet source: `00ddc36f74fa41925fc0cc6e9b7e6b462e96a37a`.
- Vurdert review: `fb9998b83ac1d7962edc05747d7982a99f18fcd5`.
- Image: `sha256:baa1c70f781ae887a791e52c120a674384f1b9737a6093aee2d1785aa0806a02`.
- Round ID: `20261015115219-00ddc36f-d69a86e7`.
- Offentlig test: https://samvev.pabben.org/. LAN: http://192.168.0.220:4173/.
- Diskutvidelsene på både codex-dev og claude er ferdige og verifiserte. Ikke gjenta diskendringer eller be om de samme eierhandlingene.

Les AGENTS, ROUND_12_REPORT, denne instruksen, relevant produkt-/arkitekturdokumentasjon, HOME_ASSISTANT og ADR 0023/0024. Bruk etablert publishing-checkout, bevar nyere arbeid og unngå reset. Følg prosjektets lesende fagreview, én skriver om gangen, etterreview, samlet QA og release_gate sist.

Work har kontrollert alle 246 source-input-hasher og alle 37 bildehasher/dimensjoner. Manifestbinding, de 33 kildeendringene og reviewets dokumentasjonsendringer er konsistente. Et målrettet utvalg på 20 bilder er faktisk åpnet, inkludert recovery-flytene; ingen bekreftet materiell visuell regresjon i utvalget. Serverens 374 tester, fem workspace-kontroller/bygg, 22 HTTPS-kontroller og recoverybevis er dokumentert bestått; Work har ikke omkjørt disse serverkontrollene.

Tidligere F1–F3, kalendernes I dag/I morgen/persondetaljer, husstand/personfordeling, søppeltømming og UID-løse snapshots skal bevares. Ingen generell ombygging er bestilt.

## T1. Bind hver temperaturlesing til den valgte sensoridentiteten

I vurdert kilde sender `calendar/service.ts:359` bare lagret `sensor.entity_id` til `HomeAssistantClient.readTemperatureSensor`. Klienten ved `home-assistant-client.ts:169–172` sjekker returnert entity-ID og temperaturtype, men verifiserer ikke valgt registry-ID. Bindingen oppdateres bare ved discovery/select. Kalenderlesingen løser derimot stabil registry-identitet før hvert kall.

Reproduksjon med syntetisk HA:
1. Velg registry A med entity-ID `sensor.synthetic_outside`, visningsnavn og uttrykkelige leser-/displayvalg.
2. Gi A nytt entity-ID. La en annen registry B overta det gamle entity-ID-et.
3. Kjør preview/poll uten manuell listeoppdatering.
4. Dagens kode kan publisere Bs verdi under As navn og deling.

Bind både forhåndsvisning og ordinær polling til den uttrykkelig valgte stabile identiteten. Løs aktuell entity-ID sikkert før lesing og kontroller bindingen ved skriving, også ved samtidig rename/discovery. Ikke godta en annen registry-entitet som har overtatt navnet. Når identiteten ikke kan bekreftes, behold siste gyldige måling som utdatert/utilgjengelig og gi forståelig recovery. Bevar konto, navn, rekkefølge og rettigheter ved legitim rename.

For entiteter uten registry-identitet: behold en eksplisitt dokumentert begrensning og sikker nyvalideringsvei; ikke lov stabilitet som ikke kan bevises. Ikke slå sammen sensorer eller overfør deling til en ny kilde automatisk.

Test legitim rename, gjenbruk av gammelt entity-ID av B, manglende/endrede registry-rader, preview og worker, samtidig bindingendring og retur av feil entity-ID. Bruk avgrensede HA-lesekall og behold origin-/DNS-/tids-/responsvern. Ingen feil skal fremprovoseres i eierens reelle HA.

## T2. Gjenoppta temperaturer etter gyldig HA-gjeninnlogging

`provider-config.ts:126` setter sensorenes `next_poll_at=NULL` ved provider-deaktivering/originbytte. Etter vellykket OAuth setter `completeOAuth` ved `service.ts:290` bare kalenderens tidsplan. Temperaturworker ved `service.ts:594` krever en forfalt `next_poll_at`.

Reproduksjon: aktiv, delt sensor → deaktiver HA-provider → aktiver **samme HA-origin** igjen → fullfør OAuth med samme konto. Sensoren står fortsatt aktiv, men har ingen polling. Ny forhåndsvisning alene planlegger heller ikke neste henting; brukeren må også lagre sensoren manuelt. Eksisterende test deaktiverer sensoren før provider-deaktivering og dekker ikke denne banen.

Lever en fullstendig recoverybane for fortsatt aktiverte og autoriserte sensorer etter gyldig samme-konto/samme-origin-innlogging. Revalider identitet/type der nødvendig, gjenoppta ordinær polling og behold utdatert-status til en faktisk gyldig avlesning er mottatt. Brukeren skal ikke sitte med «aktiv» sensor som aldri oppdateres uten forklaring eller tilgjengelig handling.

Bevar uttrykkelig pause, frakobling, tilbakekalt myndighet og stoppede kilder. Et nytt HA-origin eller annen kontobinding gir ikke automatisk rett til å lese nye sensorer under gamle valg; krev nødvendig ny validering/godkjenning. Samordne med T1 og behold generation-/revision-/lease-vern.

Test aktiv sensor gjennom disable→enable→samme-konto OAuth, paused/inaktiv sensor, manglende kilde, tilbakekalt eier, mislykket samtykke, gammel callback/pågående poll og faktisk originbytte. Bekreft at normal kalenderrecovery og tidligere F1–F3 ikke endres utilsiktet.

## T3. Mange kalenderhendelser skal ikke skjule temperaturene

`app.ts:298–321` henter alle hjemmeelementer med en samlet grense på 300, eller 200 for display, sortert på prioritet og `starts_at NULLS LAST`. Temperaturobservasjoner opprettes uten `starts_at` i `calendar/service.ts:347/362`. Ved nok normale kalenderhendelser blir dermed ingen temperaturer returnert, og `HomeEnvironment` har ingen separat innlasting.

Reproduksjon: én aktiv, tillatt sensor og 300 tillatte kalenderhendelser med normal prioritet gir ingen temperatur i vanlig home-respons. Ved display skjer det ved 200. Flere kalendere med lange synkvinduer kan nå disse grensene. En isolert SQL-reproduksjon av samme sortering/grense viste sensoren ved 299/199 hendelser og bortfall ved 300/200. Dette var ikke en full API-test eller en test mot eierdata.

Sørg for at de aktiverte temperaturene brukeren/skjermen faktisk har tilgang til, er tilgjengelige uavhengig av kalenderantallet. Bruk en avgrenset, rettighetsfiltrert projeksjon eller annen forsvarlig løsning. Ikke bare hev den globale grensen eller last ubegrensede datamengder. Bevar relevante kalender-/påminnelsesvisninger og samme regler for husstand, personer, skjermer, privacy mode, frakobling og revokering.

Legg til faktiske server-/API-regresjonstester rundt begge grensene, med flere sensorer, store kalenderlister, tillatte og nektede lesere/skjermer samt SSE/oppdatering og tilbaketrekking. Bekreft at uautoriserte verdier og sensormetadata ikke kommer med.

## Verifikasjon og allerede autorisert publisering

- Reproduser T1–T3 isolert og skriv meningsfulle tester som feiler på vurdert kilde. Kjør prosjektets nødvendige samlede tester/check/build og etterreview. Dokumenter hva som er testet syntetisk og hva som faktisk er kontrollert i drift.
- Bevar migrasjoner 001–026 og checksummer; gjør bare nødvendige additive endringer. Bevar data, profilbilder, kalendere, temperaturvalg, vault, rettigheter, beskyttet hoved-.git, LANs `admin/admin`, eksisterende AI-oppdrag og tidsplaner. Ingen reseed eller manuelle modellkall.
- Ny runtime-kilde krever nytt DCO-kildecheckpoint, immutable build og kildebundne bevis. Regenerer 14 latest etter etablert rutine med validerte personvernmasker, og suppler målrettet temperaturens rename/recovery/store-lister samt relevant mobil-/displayvisning med seks fiktive personer. Ingen ny generell designmatrise.
- Mål fersk deploykapasitet; begge gjesteutvidelsene er allerede utført. Bruk etablert backup-/restore-/recoverybane og kontroller nødvendige kandidat-/migrasjonsforutsetninger. Bevar nyere brukerdata. Ikke gjenbruk gammel R10-rollback som om den støtter schema26 og nye innstillinger.
- Publiser ferdig, verifisert retting til https://samvev.pabben.org/ uten ny generell tillatelse. LAN er QA-mellomsteg. Kontroller faktisk deployet source/image/schema, app/worker/database, HTTPS-inn-/utlogging, nye temperaturbaner, tilgangsgrenser og SSE. Bevar begge miljøer.
- Oppdater M1_STATUS og lag en kort oppfølgingsrapport med source/review/deploy-SHA, round ID, T1–T3-resultater, tester, endrede filer, kildebundne bilder og recoverystatus. Bevar historiske rapporter.

## Eierhandlinger og status som ikke skal overdrives

R12s ekte LAN-Spond-synk gjaldt foregående source `a665cb7f`, ikke et nytt livebevis på alle endelige endringer. Offentlig HA-kobling er separat fra LAN. Eieren må fortsatt velge/forhåndsvise/aktivere ønskede kalendere, søppel og temperaturer på offentlig GUI dersom dette ikke allerede er gjort. Google/Microsoft krever eventuell appregistrering og kontosamtykke. Sjekk eksisterende privat oppsett før du ber om noe på nytt, og bevar eventuelle nye eierendringer.

Disse samtykkene blokkerer ikke isolert retting/testing eller publisering av T1–T3. Ikke kopier tokens blindt mellom miljøer, be om hemmeligheter i chat eller aktiver nye kilder på eierens vegne som test. Gi bare konkrete resterende GUI-handlinger og skill dem fra ferdig kode. Ingen private navn, sensor-ID-er, kalenderinnhold eller verdier i offentlige artefakter. ChatGPT/lokal AI er fortsatt egne restpunkter.

Fortsett autonomt med tilgjengelige deler innen eksisterende goal-budsjett. DCO-signert push bare til `feat/m3-family-hub`. Ingen PR, merge, main-/force-push, tag/release eller Actions-dispatch. Ingen ny disk-/vertendring er bestilt.
