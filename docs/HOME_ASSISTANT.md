# Spond via Home Assistant – valgfri Samvev-kobling

Home Assistant er valgfritt. Google og Microsoft kobles direkte uten HA.
Spond Tracker er allerede installert hos eieren; denne pakken ber ikke om
reinstallasjon, YAML, automasjonsendringer eller HA-restart.

## GUI-flyt

Åpne `/?tab=integrations&setup=spond` → **Via Home Assistant**. En
installasjonsadministrator godkjenner først den faktiske HA-opprinnelsen i
Kalenderoppsett. Ikke gjett adresse. Klikk Koble til, logg inn og godkjenn hos HA,
velg en faktisk oppdaget Spond-kalender, velg personer og separat lesere/skjermer,
forhåndsvis og aktiver. Spond-passordet forblir i HA.

Samvev bruker HAs nettleserautorisasjon med Samvev-origin som klient-ID og
returadresse på samme host/port. Langlivet tokenkopiering er ikke normal flyt.
HA dokumenterer ikke PKCE for denne flyten; Samvev påstår ikke det. Engangs state
og fullføring er bundet til den innloggede Samvev-sesjonen og CSRF-beskyttet.
Tokens lagres kryptert, og frakobling stopper lokal synk og forsøker å tilbakekalle
refresh-tokenet. Entitetsfiltrering i Samvev begrenser **ikke** automatisk
HA-tokenets rettigheter; tokenet følger den autoriserte HA-brukeren.

Bare godkjent eksakt origin og avgrensede HTTP-/WebSocket-leseendepunkter brukes,
med DNS-pinning, absolutte tidsfrister fra før DNS, begrensede svar og uten redirects. Tokenutveksling/revocation er
nødvendige autorisasjonskall; ingen HA-tjenester eller Spond-svar sendes. Samvev
endrer ikke Pangolin, nettverksvern eller eksponerer HA offentlig. Nettverksveien
må fungere både for brukerens nettleser og Samvev-serveren.

## Faktisk kildevalg og import

Oppdagelse kombinerer HAs entity registry med `/api/calendars` og viser alle
tilgjengelige HA-kalendere. Bare en registry-rad med
`platform=spond_tracker` merkes som Spond; entitetsnavn alene beviser ikke
Spond-proveniens. Kildens stabile, rå registry-ID brukes som kildeidentitet og
aktuell entity-ID løses på nytt ved henting, slik at navneendring ikke lager en
ny kilde. Config-entry-ID følger proveniensen. Hvis HA ikke har en registry-rad,
bruker Samvev en navneområdesatt entity-ID og viser at stabilitet ved navneendring
ikke kan garanteres.
Samvev knytter ikke personer automatisk etter navn. Vanlige voksne har privat
kobling til seg selv; riktig husstandsautoritet kan velge andre personer og
uavhengig leser-/displaydeling.

Synk leser `/api/calendars/<valgt entity>?start=…&end=…` for samme avgrensede
vindu gjennom hentingen. Sensorens «neste hendelse» eller `upcoming_events` brukes
ikke som komplett import. Oppgaver som tracker faktisk tilbyr som kalenderposter
kan leses; de oppretter ingen AI-oppdrag, poengoppgaver eller påmeldinger. Ingen
chat-/innboks-/vedleggsstøtte eller aksept-/avslagstjenester loves.

En hendelse med leverandør-UID beholder denne identiteten. For generelle
HA-kalendere som faktisk utelater UID, bruker Samvev en separat lokal
snapshot-identitet: eksakt kanonisk innholdsdigest og duplikatnummer innen samme
snapshot. Den flytter aldri metadata mellom en lokal snapshotidentitet og en
leverandøridentitet, og den slår aldri sammen hendelser på omtrentlig tittel og
tid. Eksakt like legitime duplikater beholdes. En komplett, avgrenset henting
kan trekke tilbake manglende forekomster bare innen vinduet den faktisk dekket;
innhold utenfor vinduet og siste gyldige innhold ved feil beholdes. Kjente
strukturerte CalendarEvent-statuser bevares når de finnes; manglende status er
ukjent. Emoji tolkes ikke som autoritativ status. Beskrivelser forkastes siden
de kan inneholde andre deltakere og oppgavelister. Bare nødvendig tittel, dato,
eventuell lokasjon og kildeidentitet importeres.

Full snapshot brukes ved oppstart/periodisk synk og etter avbrudd; ingen
endringshendelse er nødvendig for gjenoppretting. Gjentatt synk er idempotent.
Feil er ikke tom kalender: siste gyldige innhold blir stående med utdatert-status.
Hver valgt HA-kalender har eget komplett vindu, siste vellykkede synk og
feilstatus. Hvis én kilde feiler, kan en annen komplett kilde oppdateres i samme
forsøk; den mislykkede kilden beholder innhold og vindu som utdatert. En
autentiserings-, konfigurasjons-, rettighets- eller total størrelsesfeil avbryter
hele forsøket. Ved worker-oppstart fremskyndes bare en allerede planlagt,
tilkoblet og autorisert HA-synk. Feiltilstand, frakobling og manglende plan vekkes
ikke automatisk.
Frakobling trekker tilbake importerte visninger, ikke egne Samvev-avtaler.
Velg uttrykkelig én importkilde hvis samme Spond-data også finnes i Google eller
Outlook. Ingen fuzzy sammenslåing på tittel/tid.

## Kildebegrensninger – ikke en påstand om installert versjon

Upstream-kontrakten undersøkt 14. oktober 2026 er commit
`0d8efdd06cf39763807cec0fc114fbdaa6bf87a6`, manifest 0.12.2. Dette er en
referanse, **ikke** verifisering av eierens installerte versjon:

- Kalenderen inkluderer arrangementer og enkelte oppgaver innen trackerens
  avgrensede cache. Standard er 60 dager, med konto-/hentegrenser; forespørsel
  etter 180 dager beviser ikke komplett 180-dagers dekning.
- Declined-arrangementer og declined/cancelled-oppgaver filtreres ved kilden.
  Samvev kan ikke gjenopprette statuser eller oppgaver som HA ikke returnerer.
- Sensorens kommende liste er begrenset til ti og er ikke brukt for import.
- Tracker grupperer ved første fornavn. Mulig sammenblanding skal avklares i HA;
  Samvev kan ikke reparere dette med usikker navnematching. La tvetydig kilde
  være inaktiv.
- Oppgave-UID kan endres ved endret oppgavenavn. Begrensningen vises før aktivering.

Kildens begrensningsvarsel er synlig før forhåndsvisning og aktivering. Faktisk
installasjon, versjon, datatilgang, entiteter og eierkoblinger krever autorisert
livekontroll; lokal protokolltest er ikke dette beviset.

Kilder:
[HA autorisasjon](https://developers.home-assistant.io/docs/auth_api/),
[HA REST](https://developers.home-assistant.io/docs/api/rest/),
[HA rettigheter](https://developers.home-assistant.io/docs/auth_permissions/),
[tracker kalender](https://github.com/agjendem/ha-spond-tracker/blob/0d8efdd06cf39763807cec0fc114fbdaa6bf87a6/custom_components/spond_tracker/calendar.py),
[tracker sensorer](https://github.com/agjendem/ha-spond-tracker/blob/0d8efdd06cf39763807cec0fc114fbdaa6bf87a6/custom_components/spond_tracker/sensor.py).

## Øvrige HA-flater

Temperatursensorer oppdages som en søkbar, avgrenset side av registry-metadata.
HA-registryet inneholder ikke nødvendigvis device class eller måleenhet. Samvev
aktiverer derfor aldri en kandidat fra metadata alene: brukeren velger først en
kandidat, og en målrettet state-lesing må deretter bekrefte `temperature`, en
endelig tallverdi og Celsius- eller Fahrenheit-enhet. Samvev henter ikke hele
`/api/states`. Sensorens navn, rekkefølge og leser-/displayrettigheter er atskilt
fra kalenderkildene. Hver aktiv sensor har selvstendig pollfrist, lease og
backoff, og én observasjon. Før første vellykkede måling er verdien tom og markert
som utdatert; den blir aldri fremstilt som null grader. Senere feil og `unknown`
beholder siste gyldige verdi med feilstatus. Kildeverdienes `last_reported` og
`last_updated` valideres og beholdes separat fra Samvevs hentetidspunkt og brukes
til å vise ferskhet. En oppdatering av navn, rekkefølge eller rettigheter gjelder
projeksjonen atomisk uten å vente på neste poll. HA-responsen må oppgi nøyaktig
den valgte entiteten, og et svar forkastes dersom tilkobling, konfigurasjon,
sesjon eller eierautoritet endres mens lesingen pågår.

De tidligere planene om Samvev-publicering til HA, dashboard-generering og
allowlistede tjenester er fortsatt fremtidig scope. Denne read-only Spond-pakken
implementerer ikke disse og gjør ikke HA til Samvevs bruker-/rettighetsdatabase.
