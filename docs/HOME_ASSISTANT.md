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

Oppdagelse kombinerer HAs entity registry (`platform=spond_tracker`) med
`/api/calendars`. Entitetsnavn alene beviser ikke Spond-proveniens. Kildens
stabile registry-ID brukes som kildeidentitet; aktuell entity-ID løses på nytt
ved henting, slik at navneendring ikke lager en ny kilde. Config-entry-ID følger
proveniensen.
Samvev knytter ikke personer automatisk etter navn. Vanlige voksne har privat
kobling til seg selv; riktig husstandsautoritet kan velge andre personer og
uavhengig leser-/displaydeling.

Synk leser `/api/calendars/<valgt entity>?start=…&end=…` for samme avgrensede
vindu gjennom hentingen. Sensorens «neste hendelse» eller `upcoming_events` brukes
ikke som komplett import. Oppgaver som tracker faktisk tilbyr som kalenderposter
kan leses; de oppretter ingen AI-oppdrag, poengoppgaver eller påmeldinger. Ingen
chat-/innboks-/vedleggsstøtte eller aksept-/avslagstjenester loves.

Hendelser trenger faktisk kilde-UID; uten UID feiler hele snapshotet og siste
gyldige innhold beholdes. Ingen tittel-/tid-hash som oppdiktet identitet. Kjente
strukturerte CalendarEvent-statuser bevares når de finnes; manglende status er
ukjent. Emoji tolkes ikke som autoritativ status. Beskrivelser forkastes siden
de kan inneholde andre deltakere og oppgavelister. Bare nødvendig tittel, dato,
eventuell lokasjon og kildeidentitet importeres.

Full snapshot brukes ved oppstart/periodisk synk og etter avbrudd; ingen
endringshendelse er nødvendig for gjenoppretting. Gjentatt synk er idempotent.
Feil er ikke tom kalender: siste gyldige innhold blir stående med utdatert-status.
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

De tidligere planene om Samvev-publicering til HA, dashboard-generering og
allowlistede tjenester er fortsatt fremtidig scope. Denne read-only Spond-pakken
implementerer ikke disse og gjør ikke HA til Samvevs bruker-/rettighetsdatabase.
