# Samvev

> Hverdagen, vevd sammen.

**Samvev** er en gratis plattform med åpen kildekode som gjør informasjon om til nyttige beskjeder, varsler og handlinger for en husholdning eller en annen liten gruppe.

En bruker skal kunne skrive:

> Sjekk ukeplanen for 1A. Gi oss en kort oppdatering hver morgen, varsle straks dersom noe viktig endres, og vis det vi må huske på kjøkkenskjermen.

Samvev lagrer dette som et varig oppdrag, følger kilden, bruker en godkjent AI-leverandør bare der innhold må tolkes, og leverer resultatet til riktige personer og skjermer.

## Status

**M1 har bestått akseptansetesting og Git-leveransen er verifisert. M2.2 legger til konfigurerbare OpenAI- og lokale OpenAI-kompatible KI-leverandører. Det finnes ingen produksjonsutgave.**

Den første kjørbare delen omfatter husholdningsoppsett, personer og roller, parkoblede skjermer, umiddelbare og planlagte beskjeder, norsk bokmål og engelsk samt lys og mørk visning. Start med [lokal demo](docs/implementation/M1_DEMO.md), [leveranse og testresultater](docs/implementation/M1_DELIVERY.md) og [veiledning for lokal kjøring](docs/implementation/M1_OPERATIONS.md). Produktvisjonen nedenfor beskriver også fremtidige funksjoner. M1 har ingen eksterne integrasjoner, AI, egen iOS-app, belønninger eller stemmestyring.

M2.2 bygger videre på M2.1 med et lokalt/OpenAI-kompatibelt Chat Completions-endepunkt som administrator kan konfigurere, rutine- og sterk modell, valgfri kryptert nøkkel, tilkoblingstest, brukslogg og SSRF-beskyttelse som tillater localhost og LAN. KI er deaktivert i utgangspunktet. ChatGPT-abonnement er fortsatt delvis utredet og utilgjengelig. Se [leveransen for M2.2](docs/implementation/M2_2.md) og [providerbeslutningen](docs/decisions/0012-ai-provider-foundation.md). Ukeplanmonitoren er ikke implementert.

[Read the English introduction](README.md)

## Hva Samvev er

Samvev er ikke en egen skoleplan-app og skal ikke erstatte Homey eller Home Assistant. Det er et generelt koordineringslag som kan knytte sammen:

- overvåkinger og oppsummeringer opprettet med naturlig språk
- planlagte familiebeskjeder
- personlige og delte dashboard
- iPhone-varsler og widgeter på hjemskjermen
- Homey-varsler, Flows og hendelser
- valgfri Home Assistant-integrasjon
- kalendere, nettsider, PDF-er, webhooks og senere flere tjenester
- oppgaver barna kan ta, individuelle belønninger og felles mål

Ukeplanen for 1A er en god pilot fordi den tester hele kjeden fra kilde og endringsdeteksjon til AI-tolkning, varsel, originalkilde og delt skjerm.

## Grunnprinsipper

1. **Nyttig før smart.** Vanlig kode håndterer tidspunkt, endringer, rettigheter og levering. AI tolker og oppsummerer.
2. **Flere brukere fra starten.** Personlig, familie- og skjerminnhold holdes adskilt og håndheves på serveren.
3. **Design er del av produktet.** Mobil, familieskjerm og kompakt veggskjerm utvikles sammen, med lys og mørk visning.
4. **Homey er en førsteklasses integrasjon.** Home Assistant er valgfritt og skal ikke være et krav.
5. **Selvhosting skal være komplett.** Programvaren kan brukes uten Samvev-abonnement. Betalt hosting kan senere selge enkel drift og støtte.
6. **Forbedringer skal komme fellesskapet til gode.** Server, web og skjermklienter planlegges under AGPL-3.0-or-later.
7. **Kilde før sammendrag.** AI-genererte varsler skal beholde originalkilde, hentetid og usikkerhetsstatus.
8. **Trygge standardvalg for barn.** Fellesskjermer viser bare eksplisitt tillatt informasjon.
9. **Flerspråklig fra grunnmuren.** Norsk bokmål og engelsk blir de første språkene.
10. **Uavhengig av AI-leverandør.** Lokal AI og skytjenester skal kunne bruke samme avgrensede verktøy og datamodeller.

## Planlagte flater

| Flate | Hovedoppgave |
|---|---|
| iPhone-app | Personlig oversikt, varsler, beskjeder, AI-oppdrag og familiehandlinger |
| iPhone-widgeter | Neste viktige punkt, ting å huske og familiebeskjeder |
| Felles webskjerm | Oversikt som kan leses på avstand på kjøkken, i gang, kjøleskap eller stor skjerm |
| Shelly Wall Display XL | Kompakt, stedsrelevant status og raske handlinger |
| Webadministrasjon | Førstegangsoppsett, integrasjoner, rettigheter, oppdrag og skjermer |
| ChatGPT/MCP | Opprette, vise, pause og endre varige Samvev-oppdrag fra vanlig språk |

## Dokumentasjon

- [Visjon](docs/VISION.md)
- [Produktkrav](docs/PRODUCT_REQUIREMENTS.md)
- [Arkitektur](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Førstegangsoppsett](docs/FIRST_RUN_SETUP.md)
- [Brukere og rettigheter](docs/USERS_AND_PERMISSIONS.md)
- [AI-oppdrag og varsler](docs/AI_TASKS_AND_NOTIFICATIONS.md)
- [Planlagte beskjeder](docs/MESSAGES.md)
- [Belønninger og oppgavebørs](docs/REWARDS_AND_TASK_BOARD.md)
- [Integrasjoner](docs/INTEGRATIONS.md)
- [Designsystem og fem konsepter](docs/DESIGN_SYSTEM.md)
- [Personvern og sikkerhet](docs/PRIVACY_AND_SECURITY.md)
- [Første backlog](docs/backlog/INITIAL_ISSUES.md)

## Bidrag

Utviklere, designere, oversettere, testere og dokumentasjonsbidragsytere er velkomne. Les [CONTRIBUTING.md](CONTRIBUTING.md) og [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Bidrag signeres etter [Developer Certificate of Origin 1.1](DEVELOPER_CERTIFICATE_OF_ORIGIN.md).

## Lisensiering

- Server, worker, web og skjermkode: **AGPL-3.0-or-later**
- Planlagt iPhone-app og WidgetKit-utvidelse: **MPL-2.0**, med forbehold om ny dokumentert avgjørelse før utgivelse
- Dokumentasjon og original dokumentasjonsgrafikk: **CC BY-SA 4.0**, med mindre annet er oppgitt
- Navn og logo behandles separat; repositoryet hevder ikke at navnet er registrert som varemerke

Se [LICENSE_POLICY.md](LICENSE_POLICY.md).

## Betalt hosting

En framtidig driftet tjeneste kan ta betalt for hosting, sikkerhetskopier, oppgraderinger, overvåking, support og valgfritt AI-forbruk. Målet er å selge enkel drift, ikke å holde sentrale funksjoner unna selvhostere.

## Navnestatus

**Samvev** er prosjektets nåværende navn. Formell kontroll av varemerke og domener er ikke fullført.
