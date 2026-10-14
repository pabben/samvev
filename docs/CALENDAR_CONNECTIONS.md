# Kalenderkoblinger i Samvev

Samvev leser Google Kalender, Outlook/Microsoft 365 og HTTPS-baserte ICS-abonnementer. Den sender ikke invitasjoner eller endringer tilbake til kalenderen. Spond bruker den samme kalenderveien, og krever at arrangementene finnes i en Google-/Outlook-kalender som kontoen faktisk synkroniserer.

## Bruk i appen

Åpne **Mer → Integrasjoner** (eller `/?tab=integrations`). Velg Google Kalender, Outlook eller Kalenderlenke (ICS). Hvis appregistreringen mangler, vises dette før ekstern innlogging. En administrator må først konfigurere serveren; det er ikke en feil ved din kalenderkonto.

1. Koble din egen konto med leverandørens samtykke, eller legg inn en privat HTTPS-abonnementslenke. Ikke send kalenderlenker, passord eller tokens i chat.
2. Velg kalender og **Gjelder hvem?**. Velg deretter separat hvem som kan lese innholdet og hvilke skjermer som kan vise det. En personkobling er ikke en leserettighet.
3. Åpne forhåndsvisning. Dette henter kalenderdata, men publiserer ingen avtaler. Kontroller tidspunkt, heldagshendelser, kilde og personvalg.
4. Aktiver abonnementet. Status viser siste vellykkede synk, pågående synk, feil eller behov for ny innlogging. Oppdater henter på nytt uten AI.
5. Koble fra når tilgangen skal avsluttes. Nye hentinger stoppes og de importerte visningene trekkes tilbake; egne Samvev-beskjeder og avtaler slettes ikke. Microsofts lokale frakobling er ikke en bekreftelse på at samtykket er fjernet hos Microsoft; fjern også Samvev i kontoens apprettigheter hvis ønskelig.

Første adapterversjon henter fullstendige, paginerte snapshots av et avgrenset vindu: siste 7 og neste 180 dager. Bare en komplett henting kan erstatte kalenderinnhold. Ved nettverks-/sidefeil beholdes siste gyldige innhold. Gjentatt synk gir ikke nye kopier. En avlyst og senere gjenopprettet forekomst får en ny intern incarnation, mens den gamle withdrawal-tombstonen beholdes. Ulike kilder slås ikke sammen bare fordi titlene ligner.

Henting er avgrenset til 100 sider, 10 000 hendelser og 8 MiB per snapshot;
provider-JSON har også en strømmet bytegrense. ICS-regler per time, minutt eller
sekund avvises før ekspansjon; daglige/ukentlige/månedlige/årlige gjentakelser
støttes innenfor vinduet og forekomstgrensen. For store svar gir en synlig feil
og beholder siste gyldige innhold. Maksimalt 12 aktive kalenderforbindelser per
husstand og varige konto-/husstands-/IP-grenser beskytter tunge operasjoner.

## Spond via kalender

Velg **Spond via kalender**. I Spond aktiverer du kalendersynk og velger en konto som også finnes i Google Kalender eller Outlook. Kontroller i denne kontoens kalender at arrangementet vises; en lokal telefonkalender alene kan ikke leses av Samvev. Velg deretter den samme kalenderen i Samvev, forhåndsvis og knytt den til riktig person. Bruk en allerede tilkoblet kilde når den finnes, så det ikke oppstår en ekstra import.

Broen henter kalenderarrangementer. Spond-meldinger, oppmøte, svar og generell gruppeadministrasjon inngår ikke. Samvev spør ikke etter Spond-passord og bruker ingen udokumentert Spond-API.

## Administrator: Google

Opprett en OAuth-app av typen **Web application**, aktiver Google Calendar API og konfigurer samtykkeskjermen med de relevante testbrukerne. Offentlig test-runtime har redirect:

```text
https://samvev.pabben.org/api/v1/calendar/oauth/google/callback
```

Legg client ID og client secret i den eksisterende private runtime-konfigurasjonen på Samvev-serveren, aldri i Git eller chat:

```dotenv
SAMVEV_GOOGLE_CALENDAR_CLIENT_ID=<your-web-client-id>
SAMVEV_GOOGLE_CALENDAR_CLIENT_SECRET=<your-private-client-secret>
```

Kalenderrettighetene er `calendar.calendarlist.readonly` og `calendar.events.readonly`. `openid`/`email` brukes til identiteten som binder kalenderkontoen. Det gis ingen kalender-skriverettighet. [Google scopes](https://developers.google.com/workspace/calendar/api/auth), [server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

## Administrator: Microsoft

Registrer en webapp med delegerte rettigheter og klienthemmelighet. Velg kontotyper som faktisk skal støttes; `common` kan brukes for en passende registrering som støtter organisasjons- og personkontoer. Offentlig redirect:

```text
https://samvev.pabben.org/api/v1/calendar/oauth/microsoft/callback
```

```dotenv
SAMVEV_MICROSOFT_CALENDAR_CLIENT_ID=<your-web-application-id>
SAMVEV_MICROSOFT_CALENDAR_CLIENT_SECRET=<your-private-client-secret>
SAMVEV_MICROSOFT_CALENDAR_TENANT=common
```

Samvev bruker `Calendars.ReadBasic`, `openid`, `email` og `offline_access`. Den begrensede leserettigheten dekker kalenderutvalg og hendelsesoversikt; innhold som body/vedlegg/invitasjonshåndtering inngår ikke. [Microsoft calendarView](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0), [OAuth authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

Bruk den bekreftede eksisterende immutable Samvev-runtime-en når konfigurasjonen lastes på nytt. Ikke bruk vanlig utviklingsstart mot den offentlige databasen. App og worker trenger de samme kalenderverdiene og den eksisterende private vault-nøkkelen. Den aktuelle deployrapporten dokumenterer nøyaktige Compose-filer og kandidat.

## Sikkerhet og bevis

OAuth bruker PKCE og kortlevd engangs state knyttet til den faktiske innloggede kontoen/sesjonen. Returen lander først på samme origin, der autentisert CSRF-beskyttet fullføring verifiserer bindingen. Leverandørtokens og ICS-lenker lagres kryptert; de publiseres ikke i kildeinformasjon eller feillogger. ICS-henting avviser private/lokale adresser, pinner DNS og kontrollerer hver omdirigering.

Runde-9-rapporten skiller isolerte adapter-/OAuth-tester, faktisk offentlig UI-kontroll og eventuell livekontroll med egen konto. Manglende registrering eller samtykke skal aldri merkes som en tilkoblet/live-verifisert kalender. Offisielle kilder kontrollert 14. oktober 2026: [Spond synk](https://help.spond.com/app/nb/articles/115529-kalendersynkronisering), [Spond kalenderkonto](https://help.spond.com/app/en/articles/361306-add-a-calendar-account-to-your-phone-settings).
