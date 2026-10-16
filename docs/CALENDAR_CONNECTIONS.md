# Kalenderkoblinger i Samvev

Samvev leser Google Kalender, Outlook/Microsoft 365 og HTTPS-baserte ICS-abonnementer. Den sender ikke invitasjoner eller endringer tilbake til kalenderen. Spond bruker primært Home Assistant-adapteren i den samme kalenderlivssyklusen; Google-/Outlook-broen beholdes som eksplisitt alternativ. Se [Home Assistant](HOME_ASSISTANT.md).

## Bruk i appen

Åpne **Mer → Integrasjoner** (eller `/?tab=integrations`). Velg Google Kalender, Outlook eller Kalenderlenke (ICS). Hvis appregistreringen mangler, vises dette før ekstern innlogging. En installasjonsadministrator må først fullføre appregistreringen i GUI-veiviseren; det er ikke en feil ved din kalenderkonto.

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

## Spond via kalender – alternativ

Velg **Spond via kalender**. I Spond aktiverer du kalendersynk og velger en konto som også finnes i Google Kalender eller Outlook. Kontroller i denne kontoens kalender at arrangementet vises; en lokal telefonkalender alene kan ikke leses av Samvev. Velg deretter den samme kalenderen i Samvev, forhåndsvis og knytt den til riktig person. Bruk en allerede tilkoblet kilde når den finnes, så det ikke oppstår en ekstra import.

Broen henter kalenderarrangementer. Spond-meldinger, oppmøte, svar og generell gruppeadministrasjon inngår ikke. Samvev spør ikke etter Spond-passord og bruker ingen udokumentert Spond-API.

## Installasjonsadministrator: engangsoppsett

Åpne **Integrasjoner → Kalenderoppsett** med `installation.manage`. En vanlig
husstandsadministrator eller et familiemedlem kan ikke endre installasjonens
leverandørregistrering. Google-/Microsoft-kontoer kobles deretter separat gjennom
leverandørens innlogging. Vanlige voksne kan administrere egne private koblinger;
deling til andre personer eller skjermer krever husstandsrettighetene. Barn og
skjermer får ikke kalenderadministrasjon.

Direkte innganger (krever innlogging):

- Google: `/?tab=integrations&setup=google`
- Microsoft: `/?tab=integrations&setup=microsoft`
- Spond/Home Assistant: `/?tab=integrations&setup=spond`

**Google:** Følg de fem trinnene i veiviseren i denne rekkefølgen. (1) Aktiver
Google Calendar API i Cloud-prosjektet operatøren eier. (2) Opprett en OAuth Web
client og legg inn den nøyaktige returadressen veiviseren viser. (3) Fyll ut
Google Auth Platform → Branding med appnavnet, denne installasjonens offentlige
hjemmeside `/om`, personvern `/personvern`, vilkår `/vilkar`, domenet og
kontaktopplysningene som vises i tabellen. Google må la operatøren velge en
kvalifisert supportkonto eller -gruppe; en e-postadresse i appen velger ikke
den for operatøren. Logo er valgfritt; Google anbefaler et kvadratisk bilde på
120 × 120 piksler for best visning, og filen kan være maks. 1 MB. Under Branding åpner du **View issues**,
retter eventuelle mangler og bruker **Ready to publish → Publish branding**.
Googles godkjente Branding-resultat er gyldig i sju dager. Dette er separat fra
OAuth-appens Audience-publisering. (4) Velg Audience: Internal bare for en
administrert Workspace-app for organisasjonen, ellers External. Testing krever
oppførte testbrukere (maks. 100) og refresh-token for kalender utløper normalt
etter sju dager. Når du er klar, bruk **Publish app** for å sette External-appen
til **In production**. Dette endrer appens tilgjengelighetsstatus for hele Google
Cloud-prosjektet. Hvis knappen er deaktivert, fullfør påkrevde Branding-felt og
eventuelle kontroller av domeneeierskap. Branding-verifisering av appidentitet
og domene er separat fra OAuth-verifisering av sensitive/begrensede scopes;
publisering betyr ikke at scope-ene er verifisert. Personlig bruk med færre enn
100 brukere kan kvalifisere for scope-verifiseringsunntak, men fjerner ikke OAuth-
regler, advarsler eller samtykkekrav. (5) Lagre klientregistreringen i Samvev,
koble til kalenderkontoen, velg kilder, forhåndsvis og aktiver. Innbyrdes
avhengigheter kan kreve at et felt gjøres klart i et tidligere trinn, men følg
veiviserens rekkefølge for konsolloppsettet.

Importer web-klientens JSON i skjemaet, eller legg inn klient-ID og hemmelighet
manuelt. Samvev validerer webtype, felter og returadresse; importerte endepunkter
brukes aldri til å styre nettverkskall. Både dokumenterte eldre og aktuelle
Google-filformater støttes. Ikke bruk service-account- eller installed-client-
filer. Google scopes er `calendar.calendarlist.readonly`,
`calendar.events.readonly`, `openid` og `email`.

Leserettighetene er `calendar.calendarlist.readonly`, `calendar.events.readonly`,
`openid` og `email`. En External-app i Testing krever normalt testbrukerliste
(maks. 100) og kalender-refresh-token utløper normalt etter sju dager. En bruker
kan måtte fullføre Branding/domain-kontroll og separat OAuth-scope-verifisering;
publisering beviser ikke at noen av disse kontrollene er godkjent. Workspace-regler
kan overstyre tilgang; GUI-et gjennomfører ikke ekstern verifisering.

**Microsoft:** Administratoren som eier appregistreringen må kunne opprette og
administrere appen i riktig Entra-katalog. Dette er en annen rolle enn den enkelte
kalendereierens private Microsoft-konto eller jobb-/skolekonto som senere logger
inn i Samvev. I App registrations velger administratoren om appen skal støtte
bare organisasjonskontoer, personkontoer eller begge. Legg inn Web-returadressen
veiviseren viser, kopier Application (client) ID og klienthemmelighetens **verdi**
til Samvevs sikre skjema, og bruk bare katalogautoriteten som samsvarer med
registreringen. `common` støtter registreringer for begge kontotypene;
`organizations`, `consumers` og en konkret tenant begrenser valget. Samvev viser
de faktiske delegerte scope-ene: `Calendars.ReadBasic`, `openid`, `email` og
`offline_access`; ingen kalenderwrites. Organisasjonens samtykke-/administrator-
regler gjelder fortsatt. Hvis den aktuelle katalogen tilhører arbeidsgiver eller
skole, be katalogeieren opprette eller godkjenne registreringen. Hvis du mangler
tilgang, vurder bare en katalog du selv kontrollerer dersom husstandens kontotyper
kan bruke den; dette gir ikke registreringseieren eierskap til medlemmenes
kalendere, og organisasjonsregler kan fortsatt blokkere samtykke. En
innloggingsfeil beviser ikke at en bruker er låst ute
av en bestemt årsak; kontroller kontotype, katalog, registrering og eventuelle
organisasjonsregler, og få leverandøren eller katalogadministratoren til å
bekrefte en kontospesifikk begrensning.

Microsoft opplyser at Entra-adminsenterets flyt for å legge til en ekstra Workforce-
tenant er for betalende kunder. Microsoft dokumenterer egne veier for kontoer med
gratislisens eller prøveperiode, men de er ikke et universelt løfte om at en konto
kan opprette en ny tenant. Ikke opprett en organisasjon bare for å koble til en
kalender.

Anonyme installasjonssider finnes på `/om`, `/personvern` og `/vilkar`. De bruker
samme installasjonsspesifikke kontaktkonfigurasjon; en administrator med
`installation.manage` kan oppdatere den under **Integrasjoner → Kalenderoppsett**.
Den offentlige DTO-en inneholder bare operatørnavn, postadresse og kontaktadresse.
Branding-tabellens sideadresser utledes fra installasjonens serverkonfigurerte
returadresse, ikke fra nettleserens tilfeldige LAN-/proxy-vertsnavn. For den
kjente installasjonen `samvev.pabben.org` vises `pabben.org` som autorisert domene.
Andre vertsnavn får ingen automatisk utledning; bekreft domenet med installasjonseier.
Innlogging er `/`, og innstillingslenken går til `/?tab=integrations`.

Appregistrering mangler, app konfigurert, konto tilkoblet og vellykket synk er
fire forskjellige tilstander. Lagret skjema betyr ikke at noen konto eller
kalender er kontrollert. Hemmeligheter returneres aldri fra API eller fylles inn
igjen i skjemaet. Endring er eksplisitt full erstatning; deaktivering krever
bekreftelse og stopper videre bruk av gammel registrering.

### Én konfigurasjonskilde og trygg overgang

Registrering lagres kryptert i `installation_calendar_provider_configs` med
installasjons-/leverandørbinding i den eksisterende vaulten. App og worker leser
samme kilde. Uten DB-rad brukes allerede eksisterende private miljøverdier. Når
administrator lagrer en rad, er den autoritativ; en disabled-rad faller **ikke**
tilbake til miljøverdier. .env redigeres ikke automatisk. Identisk klient med ny
hemmelighet bevarer kontoens refresh-token og fencer pågående arbeid; ny klient
krever nytt kontosamtykke. Ingen ekstra master-nøkkel eller konkurrerende cache.

Oppsettet må tas med i samme databasebackup og bruke eksisterende vault-nøkkel
ved restore. Gammel kode kan ikke lese GUI-registrering eller nye HA-koblinger;
se ADR 0023 og migrasjon 025 før image-rollback. Ikke erstatt live data med en
eldre backup uten en eksplisitt gjenopprettingsbeslutning.

Kilder kontrollert 14. oktober 2026:
[Google OAuth/tokenutløp](https://developers.google.com/identity/protocols/oauth2),
[Google app states](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview),
[Google Branding](https://support.google.com/cloud/answer/15549049),
[Google Testing](https://support.google.com/cloud/answer/15549945),
[Google personal-use verification exception](https://support.google.com/cloud/answer/13464323),
[Google web JSON](https://github.com/googleapis/google-api-python-client/blob/main/docs/client-secrets.md),
[Microsoft registrering](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app),
[Microsoft account types](https://learn.microsoft.com/en-us/entra/identity-platform/v2-supported-account-types),
[Microsoft tenant eligibility](https://learn.microsoft.com/en-us/entra/fundamentals/create-new-tenant),
[Microsoft calendarView](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0).

## Sikkerhet og bevis

OAuth bruker PKCE og kortlevd engangs state knyttet til den faktiske innloggede kontoen/sesjonen. Returen lander først på samme origin, der autentisert CSRF-beskyttet fullføring verifiserer bindingen. Leverandørtokens og ICS-lenker lagres kryptert; de publiseres ikke i kildeinformasjon eller feillogger. ICS-henting avviser private/lokale adresser, pinner DNS og kontrollerer hver omdirigering.

Runde-9-rapporten skiller isolerte adapter-/OAuth-tester, faktisk offentlig UI-kontroll og eventuell livekontroll med egen konto. Manglende registrering eller samtykke skal aldri merkes som en tilkoblet/live-verifisert kalender. Offisielle kilder kontrollert 14. oktober 2026: [Spond synk](https://help.spond.com/app/nb/articles/115529-kalendersynkronisering), [Spond kalenderkonto](https://help.spond.com/app/en/articles/361306-add-a-calendar-account-to-your-phone-settings).

Ved mislykket synk, deaktivert registrering eller tap av eierautorisasjon beholder
medlems- og skjermprojeksjoner siste gyldige kalenderinnhold med sanitisert
utdatert-status. Eierens kontodetaljer eller interne feil deles ikke. Videre
henting stoppes når eierautorisasjonen mangler.
