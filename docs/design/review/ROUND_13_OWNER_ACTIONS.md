# Runde 13 – sjekkliste for eierhandlinger

Sjekklisten gjelder etter utrulling av kilde `7c61557b92333408c628911784aff267411479ba`. Den inneholder ingen navn, oppgavetitler, kontaktverdier, klienthemmeligheter eller konto-ID-er.

## Aktiver visning av lagrede skoleoppgaver

Bruk en ekte innlogget økt med `household.manage` for husstanden. Den tilgjengelige testpåloggingen tilhører en annen husstand; ikke bruk den til å opptre som denne husstandens medlem.

1. Åpne [Oppdrag](https://samvev.pabben.org/?tab=monitors). Finn riktig eksisterende skoleoppgave ut fra faktisk kilde og personkobling. Ikke lag en kopi eller endre instruksjoner, mottakere, godkjenning eller tidsplan.
2. Velg **Skolevisning …** på oppgaven og kryss av **Vis validerte skoleaktiviteter i familiens tidslinjer**.
3. Velg **Skjul skoleaktiviteter etter**. Bruk kjent sluttid for skoledagen på den aktuelle datoen; hvis ukjent, bruk standarden 13:00 lokal tid på denne datoen.
4. Velg **Lagre**. Ikke velg «nå», og ikke kjør eller send oppgaven. Dette endrer kun visningsmetadata på eksisterende oppgave. Det skal ikke kalle AI eller endre godkjenning/tidsplan. Kontroller visningen og at historikk er bevart i den autoriserte husstandsvisningen.

Hvis kilde eller personkobling er uklar, stopp og avklar det i den autoriserte husstandsvisningen før lagring. Ikke utgi deg for å være en annen bruker eller kopier oppgaven.

## Google Kalender

Åpne [Google-oppsett](https://samvev.pabben.org/?tab=integrations&setup=google). Veiviseren dekker fem trinn:

1. Slå på Google Calendar API i eierens valgte Cloud-prosjekt.
2. Opprett OAuth-klienten. Kopier callback-adressen fra Samvev og registrer den ordrett; ikke bruk en LAN-adresse.
3. Fyll ut Google Branding-feltene fra veiviseren. Velg støtte-e-post separat i Google-velgeren. Ikke lagre kontaktverdier i repoet.
4. Kontroller Audience, test kontra publisering og be om bare omfangene veiviseren viser. Følg Googles gjeldende krav for valgt kontotype.
5. Lagre klientoppsettet i admin. Autoriser ønsket kalenderkonto, velg kalendere og forhåndsvis kildedata. Velg separat hvem kalenderen gjelder, hvem som får lese, og hvilke skjermer den deles med; aktiver bare ønskede kalendere.

Oppsettssiden er utrullet, men den offentlige funksjonskontrollen dekket ikke OAuth-samtykke, kontotilkobling, kalenderaktivering eller synkronisering. Klientoppsett alene beviser ikke at kalenderen er tilkoblet eller virker.

## Microsoft Kalender

Åpne [Microsoft-oppsett](https://samvev.pabben.org/?tab=integrations&setup=microsoft). Installasjonseieren registrerer appen i sin katalog, bruker callback-adressen Samvev viser, setter opp viste tillatelser og lagrer appinnstillingene. Dette er adskilt fra kalenderkontoens autorisering. Koble så til ønsket personlig- eller jobbkonto, velg kalendere og forhåndsvis data. Velg separat hvem kalenderen gjelder, hvem som får lese, og hvilke skjermer den deles med før aktivering.

Følg gjeldende veiledning for kontotype og samtykke. Ved blokkert innlogging: noter meldingen og kontakt kontoens administrator. Ikke gjett årsaken, opprett en ny organisasjon/katalog eller kall det leverandørfeil uten belegg. Appregistreringssiden er utrullet; eierens samtykke, kontotilkobling og synkronisering er ikke verifisert.

## Spond-kalender

[Åpne Spond-oppsett](https://samvev.pabben.org/?tab=integrations&setup=spond). Kontroller status og tilgjengelige tilkoblingsvalg i veiviseren. Lenken dokumenterer ikke ny tilkobling eller vellykket synkronisering.

## Home Assistant

Ingen fysiske HA-kommandoer ble sendt. Syntetisk transport er godkjent verifikasjonsgrense; fysisk testing er valgfri og ikke et fullføringskrav. Ved senere eiertest: bruk bare eksplisitt valgte enheter/handlinger og tilgang per person/skjerm. Ikke kjør automatiske tester, kølegg kommandoer ved frakoblet HA eller bruk ekte garasje/lys som testobjekt.

Se også [kravmatrisen](ROUND_13_REQUIREMENTS.md), [status](ROUND_13_STATUS.md) og [rapporten](ROUND_13_REPORT.md).
