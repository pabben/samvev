# Samvev – runde 9: profilbilder, kalendere, Spond, forståelig AI og referansedesign

Dette er den samlede erstatningen for runde-9-prompten i commit `5b5bcbb5fe19abfac43202df4e434796a2451888`; den forrige er ikke startet. Fortsett i samme Codex-økt og bevar utført arbeid. Runde 8 er publisert; den gamle SSH-/deployblokkeringen er lukket. Brukeren har nå bestilt både funksjonene nedenfor og den tidligere designoppfølgingen. Work endrer bare mailboxen; server-Codex implementerer, tester og publiserer.

## Mål og autonom gjennomføring

Arbeid under et aktivt `/goal` til hele det bestilte omfanget er implementert, kontrollert og publisert som offentlig testversjon, eller til alle gjenværende deler faktisk krever brukerinnsats. Målet omfatter profilbilder, Google-/Outlook-/ICS-kalendere, en dokumentert Spond-vei, enkel ChatGPT-veiviser, oppdrag knyttet til personkort, tidligere designrettinger og avgrenset lokal AI-diagnose. Kode, tester, faktiske skjermbilder og en ærlig leveransematrise er bevisgrunnlaget.

Lag og vedlikehold en konkret delplan; gjennomfør hele kjeden fra datalagring og API til brukerflyt og drift. Velg rutinemessige implementasjonsdetaljer selv. Følg AGENTS med parallelle lesende fagvurderinger og én skrivende agent om gangen. Etter hvert delmål: vurder bevis, rett bekreftede feil, fortsett til neste uferdige del. Ikke avslutt ved en plan, en mockup, grønne enhetstester alene eller et enkelt ferdig delmål. Bevar sjekkpunkter og gjenopptakingsnotat ved kontekst-/budsjettgrense; ikke kjør en endeløs kontrollsløyfe når målet er nådd.

Manglende OAuth-appregistrering, brukerinnlogging/samtykke, kalenderlenke eller avklaring av Google-abonnement skal bare blokkere den aktuelle live-tilkoblingen. Fullfør dens kode, veiviser, konfigurasjonsforberedelse og syntetiske tester, og fortsett med resten. Samle til slutt konkrete brukerhandlinger med riktig side/knapp/kommando. Ikke be om passord eller tokens i chat. Ikke omgå samtykke, slå på betaling eller koble en annen konto for å komme videre. Skille mellom «implementert og isolert testet», «venter på tilkobling» og «verifisert med ekte konto» er et ferdigkrav, ikke en anledning til å kalle en stub ferdig.

## Baseline og faktisk review

- Repo/branch: `pabben/samvev`, `feat/m3-family-hub`.
- Vurdert og dokumentert deployet kilde: `15d047192abd63f4be18a90108fe969096da78d0`.
- Ny offentlig review SHA: `bbe5d4edc6da1de2d309c5eb11898a825d22d384`.
- Ordinær lokal round ID: `20261013220837-15d04719-3db04bd7`.
- Offentlig testversjon: https://samvev.pabben.org/.
- Publiseringen endret ikke applikasjonskoden. `ROUND_8_PUBLIC_DEPLOY.md` erstatter tidligere BLOCKED-status; ikke start tilgangsoppsettet på nytt.

Work har kontrollert kilde/scope og hasher/dimensjoner for alle 50 publiserte offentlige bilder, lest rapport/checks/recovery/SSE, åpnet et representativt offentlig bildeutvalg og sammenlignet med den allerede vurderte runde 8. Ikke skriv at Work har åpnet alle 50 eller kjørt serverkontrollene på nytt. Ingen ny visuell P0/P1-regresjon ble funnet i utvalget. Rapporten registrerer 56 beståtte HTTPS-kontroller og nåværende restore PASS; dette er server-Codex sine utførte kontroller.

Offentlig bildesett viser én bevart syntetisk person med begrensede rettigheter og lite innhold. Det erstatter ikke den innholdsrike seks-personersprøven. Runde 8s isolerte hovedfixture er fortsatt seks personer, to voksne og fire barn; ordinær LAN har fem bevarte personer. Manglende administrative knapper i offentlig testkonto er ikke i seg selv feil.

Felles appskall, seks-personers reflow og offentlig testpublisering er levert. Nær identisk design og fungerende lokal AI er ikke godkjent. Brukerens krav om høyest mulig likhet med originalene står ved lag; grønn QA er ikke visuell godkjenning.

Les AGENTS, review-README, denne mailboxen, ROUND_8_REPORT, ROUND_8_PUBLIC_DEPLOY, relevante manifests/validation og gjeldende drifts-/restore-rutine. Følg prosjektets agentarbeidsflyt med én skrivende agent om gangen. Bruk publishing-checkouten; beskytt hoved-.git. Integrer nyere arbeid dersom featurebranchen har gått videre, uten reset eller overskriving.

## 1. Komposisjon nærmere originalene

Åpne de faktiske autoritative bildene:
- `docs/design/ChatGPT Image 24. sep. 2026, 23_51_09.png`
- `docs/design/ChatGPT Image 24. sep. 2026, 23_52_06 (4).png`

Sammenlign appflatene uten rom/rammer. Navnet er Samvev; merkevarefooter/slagord skal ikke tilbake. Fire-personers sammenligning er nyttig for referansen, men seks er normaltilstanden.

**Mørk desktop/display:** I `round-8/six-home/six-desktop-1920-dark.png` strekker seks familierader hovedpanelene fra omtrent y247 til y887. Dagens tre hendelser, morgendagens ene hendelse og to påminnelser får store tomrom; familiemeldingen havner helt nederst. Gjør familieradene og hovedradens høyde mer balanserte mot referansen, med seks tydelige identiteter og nyttig aktivitetstekst. Behold hel melding/handlinger med litt luft under på 1920×1080. Ikke løs det ved å skjule personer, krympe brødtekst eller klippe paneler. Bevar den fungerende lave iPad-/Shelly-komposisjonen.

**Få personer/tomt innhold:** Offentlig `home-desktop-light.png` viser én person til venstre, et stort ubrukt midtfelt og dagsplan helt til høyre. Tilpass grid og innholdshøyde til faktisk antall også ved 1–3, uten å strekke ett personkort over all bredden. Dette er en sekundær regresjonsprøve, ikke ny hovedfixture. Kontroller 1/4/5/6/8 og tom/rik tilstand. Bevar personvalg, ikke lag data for å fylle tomrom.

Bevar landskap/materialer fra runde 8 som utgangspunkt. Foreta bare målrettede justeringer der side-ved-side viser en klar gevinst; ikke start en ny generell bakgrunnsrunde eller legg til funksjoner fra referansen. Rapporter fortsatt avstand i proporsjoner, typografi og materialer ærlig, uten egen designgodkjenning.

## 2. Konkrete UI-detaljer

- **Fokusramme:** `member.tsx` fokuserer h1 ved fanebytte og `member-shell.css` tegner stor ramme med `h1:focus`, også etter museklikk. Synlig i offentlige Messages/People/AI/Oppdrag. Behold semantisk fokus, scroll-reset og skjermleserorientering; gjør synlig fokusbehandling tilpasset navigasjonsmåten. Tastaturfokus skal fortsatt være tydelig. Kontroller faktisk mus, tastatur og fokusretur – ikke fjern outlines globalt.
- **Kompakte personkort:** `round-8/six-home/six-ipad-landscape-light.png` og `six-shelly-1280-light.png` viser «1 oppføring» pluss «1 til», uten aktivitet. Vis en kort relevant tillatt tittel der det er plass, eller en forståelig detaljinngang når ingen forhåndsvisning vises. «N til» skal beskrive ytterligere oppføringer etter faktisk vist innhold. Bevar de korrekte totalene, inkludert oppføringer som bare finnes i detaljer; ingen skjult datatap eller nye tilganger.
- **Bursdag på mobil Beskjeder:** Den isolerte seks-personersfixturen viser en stor bursdagsflate for en bursdag 33 dager frem. Den skyver den aktuelle meldingen langt ned. Gjør kommende bursdag kompakt i denne oppgavevisningen, med navn/dato bevart og prioritet til faktiske beskjeder. Behold både Ny beskjed og Nå/Planlagt/Historikk.
- **Tilbakepil:** «Tilbake til Mer» peker visuelt mot høyre i offentlige Skjermer/Integrasjoner/Oppdrag/AI. Bruk konsekvent venstrepil for retur. Kontroller øvrige delte ikoner og lesbare språk-/temavalg uten generell komponentombygging.

## 3. AI-visning: leverandør og avgrensning

`round-8/public/ai-mobile-dark.png` viser «Valgt bruksvei: Lokal leverandør» sammen med «Åpne ChatGPT-kontoens forbruk». `ai-settings.tsx` gjengir lenken ubetinget i banneret. Gjør bannerets hjelp/lenke relevant for valgt lagret leverandør. Eventuell ChatGPT-lenke kan beholdes i tydelig merket ChatGPT-tilkobling/historikk. Ikke finn på en lokal kontrollpaneladresse, ny saldo eller ny fakturering.

Flytt den eksisterende forklaringen om konto-/husstandsavgrensning nær hovedtallene. Null i testkontoens oversikt og 226 rader globalt er ikke dokumentert som en tellefeil: de gjelder ulike avgrensninger. Behold korrekt serverfiltrering og skillet mellom lokale kall, ChatGPT-kredittanslag og tilsvarende API-scenario. Ikke utvid tilgang til andre husstanders forbruk eller introduser nye kostnadsantakelser.

## 4. Avgrenset diagnose av eksisterende lokale modellfeil

Publiseringsrapporten dokumenterer to allerede godkjente, daglige oppdrag som til sammen gjorde tre mislykkede lokale OpenAI-kompatible dispatchforsøk (`AI_UPSTREAM_ERROR` / `AI_RESPONSE_INVALID`). Ingen vellykket beskjed ble laget. De tre forsøkene er beholdt i historikken; to oppdrag er fortsatt aktive. Browser-QA utløste ingen modellkall. Ikke skriv at det ikke forekom providertrafikk på serveren.

Undersøk eksisterende Samvev-logger, redigert konfigurasjon, dispatch-/responsmetadata og relevant adapterkode lesende. Skill forbindelses-/HTTP-feil fra svarformat/parserfeil. Rapportér bekreftet årsak, underbyggede hypoteser og eventuell konkret manglende informasjon. Hemmeligheter, familieinnhold og rå modellprompter skal ikke publiseres. Ikke utforsk eller endre andre apper/servere.

Denne delen bestiller diagnose, ikke nye modellforsøk: ingen manuell kjøring, retry, modelloppdagelse, ChatGPT-samtykke, credential-import eller betalt fallback. Bevar eksisterende godkjente tidsplaner og én normal worker; ikke pause all bakgrunnsdrift eller endre cadence for QA. Nye naturlige planlagte forsøk må rapporteres som bakgrunnsaktivitet. Diagnose og UI-arbeid skal kunne fullføres uten en ny vellykket live modellrespons. Ikke kall lokal AI fungerende før det finnes gyldig bevis.

## 5. Egne profilbilder for alle personer

Dagens `avatarKey` velger bare mellom medfølgende illustrasjoner. Lever reell, varig bildeopplasting på Person, også barn/personer uten innlogging. En konto og en person er ikke samme entitet. Behold illustrasjoner/initialer som valg og fallback.

- Flyt: Personer eller persondetaljer → Rediger → Last opp/ta bilde → forhåndsvis/beskjær → Lagre. Gjør det enkelt å bytte og fjerne bildet. Selvbetjening gjelder egen autorisert profil; administrasjon av andre følger eksisterende rettigheter.
- Samme bilde skal følge personen på Home, personliste, detaljer, relevante meldinger og autoriserte delte skjermer, også etter ny innlogging og containerrestart.
- Valider faktisk bildeinnhold og størrelse på serveren, normaliser orientering, lag passende varianter og fjern EXIF/GPS. Bruk beskyttet varig lagring, ikke offentlig Git eller flyktig containerdisk. Serveren må kontrollere tilgang også ved direkte bilde-URL; personkobling alene gir ingen nye display-rettigheter.
- Verifiser opplasting/bytte/sletting/fallback, ugyldig og for stor fil, rettigheter på tvers av husstander og backup/restore av bildeasset sammen med databasen. Bruk syntetiske bilder i alle publiserte bevis.

## 6. Kalenderkoblinger: Google, Outlook og andre via ICS

Dagens generiske innkommende integrasjons-API er ikke en ferdig kalenderkobling. Implementer reelle lesende adaptere for Google Calendar og Outlook/Microsoft 365 med dokumentert OAuth, og et generelt ICS-abonnement som praktisk vei for andre tjenester. Engangsimport av ICS kan supplere abonnementet hvis det gir enkel, nyttig funksjon. Toveis redigering og invitasjonsutsending inngår ikke i denne første leveransen.

- Forståelig flyt under Integrasjoner: velg leverandør → koble konto/legg inn abonnementslenke → velg én eller flere kalendere → velg hvem kalenderen gjelder og hvor innholdet kan vises → forhåndsvis → aktiver. Skill kontotilkobling, løpende abonnement og engangsimport i tekst og status.
- Vis kilde, tilknyttede personer, sist vellykket synk, pågående/feilet/utløpt tilkobling, oppdater og koble fra. Hendelser skal vises i relevant I dag/I morgen/dagsplan og persondetaljer gjennom eksisterende M3-modell, uten AI-kall.
- Bruk stabile kilde-/hendelses-/forekomst-ID-er, vedvarende synktilstand, paginering og kontrollert retry. Verifiser tidssone/Europe-Oslo/sommertid, heldagshendelser, gjentakelser/unntak, endring/avlysning/sletting og gjentatt import uten duplikater. Nettverksfeil eller ufullstendige sider må ikke tømme kalenderinnholdet. Flere kilder med samme hendelse må håndteres eksplisitt uten usikker sammenslåing bare på tittel.
- Bygg på eksisterende husstandsavgrensede integrasjonselementer, revisjoner og withdrawal-tombstones. Test også avlyst/slettet hendelse som senere gjenopprettes: eksisterende withdrawal er permanent per ekstern ID, så adapteren må håndtere legitim gjenoppretting uten å omgå tombstone-vernet eller lage doble aktive forekomster. Bevar skillet mellom hvem en hendelse gjelder og hvem som får lese den. Frakobling skal stoppe nye hentinger og håndtere tidligere importert innhold forutsigbart uten å slette brukerens egne avtaler.
- OAuth skal bruke dokumenterte minste leserettigheter, kontrollert callback/state/PKCE der relevant, kryptert serverlagring og fungerende tilbakekalling. ICS-lenker kan være hemmeligheter; skjul dem i logger, bevis og offentlig kildevisning. Gjenbruk eksisterende SSRF-vern også ved omdirigeringer.
- Gjenbruk bare bekreftet Samvev-konfigurasjon. Hvis leverandørregistrering eller samtykke mangler: lever full adapter, UI og konkrete oppsettssteg med riktige redirect-adresser; verifiser hele flyten med isolert transport. Ikke presenter knapper uten backend som levert integrasjon, og ikke marker ekte synk som testet uten faktisk bevis.

## 7. Spond som egen forståelig tilkobling

Brukerens mål er at relevant Spond-aktivitet kommer inn hos riktig person i Samvev. Undersøk gjeldende offisiell støtte før valg av adapter. Spond dokumenterer synkronisering via telefonens kalender; dette er en mulig bro til kalenderadapterne, ikke bevis på en direkte server-API eller en eksportlenke.

Lever en tydelig Spond-inngang med trinnvis oppsett og faktisk importvei. Foretrekk dokumentert direkte kobling dersom den finnes og kan brukes her. Ellers implementer Spond → valgt synkronisert Google-/Outlook-kalender → Samvev med personkobling, kilde og synkstatus. Veiviseren må hjelpe brukeren å kontrollere at kalenderen faktisk ligger i kontoen som serveren kan lese; en lokal telefonkalender alene er ikke nok. Velg kalender/gruppe bare på nivået den reelle kilden støtter, og forklar avgrensningen.

Merk broen «Spond via kalender» og hvilke data den henter. Ikke påstå støtte for Spond-meldinger, oppmøte, svar eller hele gruppeinnholdet uten implementert og dokumentert støtte. Unngå dobbeltimport hvis samme kalender også er koblet separat. Bruk syntetiske Spond-lignende hendelser til ende-til-ende-kontroll av endringer/avlysninger og personvisning. Ikke samle inn Spond-passord eller bruk udokumenterte private endepunkter som snarvei. Hvis direkte API er utilgjengelig, skal dette ikke stoppe kalenderbroen eller resten av runden.

## 8. Enkel bruksanvisning og veiviser for ChatGPT

Brukeren forstod ikke dagens oppsett. Gjør den vanlige flyten kort, norsk og trinnvis, med «Dette er klart», «Dette mangler» og én tydelig neste handling. Veiledningen skal ligge ved tilkoblingen i appen, ikke bare i en teknisk README eller flere lag med detaljer. Lag også en kort brukerveiledning som beskriver den faktisk leverte løsningen.

Eksisterende ChatGPT-planstøtte og ADR 0021 bygger på dokumentert samtykke, lokal browser-companion, privat overføring og serverimport. `docs/CHATGPT_PLAN_CONNECTION.md` viser i dag LAN/QA-kommando med `samvev-m1-qa-app-1`; ikke bruk denne ukritisk mot offentlig drift. Tilpass og forenkle den støttede flyten for faktisk Samvev-runtime. Forbered det serveren kan gjøre autonomt, og forhåndsutfyll verifiserte, ikke-hemmelige opplysninger. Hvis et lokalt hjelpetrinn er nødvendig, forklar på hvilken maskin det kjøres og gjør pakken/kommandoen ferdig. Ikke lov ett klikk i nettleseren uten støtte.

Vis separate tilstander for ikke tilkoblet, venter på samtykke/import, tilkoblet, ny innlogging nødvendig og bruksgrense. Skill autentisering fra vellykket modellforespørsel. Behold vertsidentitet, PKCE, kontobinding, kryptert vault, refresh-/revocation-vern og godkjenning per oppdrag. Ingen kopiering av nettlesercookies eller hemmeligheter via chat. Brukeren utfører sitt eget samtykke; nattarbeidet skal ikke vente på dette.

Brukeren har også sagt «google plus». Dette er ikke et bekreftet produktnavn eller dokumentert API-rettighet. Google Kalender er uavhengig av AI-abonnementet. Gemini finnes som type, men dagens runtime sier uttrykkelig `PROVIDER_NOT_IMPLEMENTED_M2_1`; ikke presenter dette som en fungerende alternativ leverandør. Vurder et Google/Gemini-alternativ mot offisiell støtte og faktisk utviklingsbehov, og forklar kort hva som eventuelt krever et annet abonnement, API-oppsett eller separat betaling. Prioriter å gjøre eksisterende ChatGPT-vei forståelig og ferdig. Eventuelt behov for eksakt Google-abonnementsnavn tas som en kort avklaring til slutt, ikke som nattens første blokkering. Ingen automatisk leverandørbytte eller aktivering av betaling.

## 9. AI-oppdrag må høre til personkort og persondetaljer

Dette er funksjonsarbeid, uavhengig av den lesende diagnosen i punkt 4. Dagens `targets.personIds/displayIds` er mottakere/publiseringsmål; `interpretedRule.people` er navn i tolket tekst. Ingen av dem er alene en autoritativ kobling til personen oppdraget gjelder. Dagens generelle oppdragslagring kaller dessuten `/interpret` automatisk.

- Innfør en eksplisitt, vedvarende kobling til én eller flere person-ID-er: «Gjelder hvem?», separat fra «Varsle/vis til». Fra persondetaljer skal «Nytt oppdrag» forhåndsvelge personen. Oppdrag kan også gjelde husstanden uten at en tilfeldig person må velges.
- La kobling/fjerning lagres som avgrenset metadata med tilgangskontroll, revisjon og audit, uten automatisk tolking, modellkall, aktivering eller endring av leverandør/tidsplan. Bevar godkjennings- og registration-generation-vern; ikke omgå dem for å holde et oppdrag aktivt.
- Personkort viser en kompakt inngang/status. Persondetaljer viser relevante oppdrag, siste/neste planlagte kontroll, siste resultat/forslag og forståelig feil. «Ikke kjørt», «Pågår», «Ingen relevante funn», «Feilet» og et eldre vellykket resultat er ulike tilstander. Oppdrag skal være synlig for autoriserte voksne også når ingen kjøring har lykkes. Lenken må lede til riktig eksisterende oppdrag.
- Vis relevante forslag fra gyldige lagrede resultater med kilde/tid/status; la brukeren se og behandle dem. Forslag til personkobling kan presenteres som redigerbare forslag, men ikke bli nye aktive oppdrag, avtaler eller varsler automatisk. Ikke dikt opp et forslag når modellen feilet. Ikke kopier samme resultat til parallelle meldinger og HubItems som gir duplikater.
- En subject-kobling skal aldri utvide lesetilgang til hele oppdraget, private instruksjoner, kilder eller diagnostikk. Lag en serverfiltrert visning for rollen og skjermen; barn/delte skjermer får bare eksplisitt tillatt innhold. Autoriserte voksne må fortsatt kunne forstå og rette problemet.
- Brukeren har uttrykkelig opplyst at to eksisterende oppdrag gjelder samme barn; personnavnet følger den private startinstruksen, ikke denne offentlige mailboxen. Identifiser riktige oppdrag og person privat i riktig husstand, og knytt de eksisterende oppdragene gjennom den nye metadataflyten når identiteten er entydig. Dette avgrensede datatillegget er bestilt. Bevar ID-er, historikk, mottakere, leverandør og godkjent tidsplan; ingen kopier eller manuell kjøring. Ved tvetydighet: vis et ferdig koblingsforslag for bekreftelse og fullfør øvrig arbeid. Ikke hardkod personnavn eller private data i offentlig kilde, tester eller bilder.

## Kilder for integrasjonsvalg og goal

Følgende primærkilder ble kontrollert 14. oktober 2026. Kontroller den aktuelle flyten mot offisiell dokumentasjon ved implementering; Samvevs kode og faktisk kontotilgang avgjør hva som er klart:

- Codex Goals: https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
- ChatGPT-plan i åpen kildekode/egen drift: https://developers.openai.com/siwc/token-sharing-open-source og veiledningene om self-hosted VMs, kontosesjoner og feil.
- Google Calendar-synk: https://developers.google.com/workspace/calendar/api/guides/sync
- Microsoft Graph-kalender: https://learn.microsoft.com/en-us/graph/delta-query-events
- Spond kalender: https://help.spond.com/app/nb/articles/115529-kalendersynkronisering og https://help.spond.com/app/en/articles/361306-add-a-calendar-account-to-your-phone-settings
- Gemini API-fakturering: https://ai.google.dev/gemini-api/docs/billing — dette identifiserer ikke brukerens abonnement.

## Bevaring, kontroll og publisering

- Seks syntetiske personer (2 voksne/4 barn) forblir hovedfixture i isolert API/database. Bevar LANs fem personer, data, preferanser og admin/admin. Bevar offentlig eksisterende kontoer/data/rettigheter; ikke reseed eller gi testkontoen nye privilegier for screenshots.
- Bevar felles appskall på alle sider, persondetaljer, mobilens skriveinnganger/dagsplanprioritering, NB/EN, reduced-motion, safe areas, 44px trykkflater, synlig tastaturfokus og naturlig scroll ved lange tekster/200 % zoom.
- Bevar serverens husstands-/rollegrenser, display-grants, SSE, offline/utløp, autentisering og AI-pris-/dispatch-/refresh-rettingene. De nye funksjonene over og nødvendige additive migrasjoner er uttrykkelig bestilt. Bevar gamle migrasjoner/checksummer; oppdater relevante kontrakter, produktkrav og ADR-er der det trengs. Ingen nye funksjoner utenfor dette omfanget.
- Test målrettet faktisk oppførsel: mus/tastatur ved navigasjon, lesbart innhold ved antallsendringer, primærhandlinger og korrekte resttall, provideravhengig forklaring. Følg prosjektets påkrevde retest/etterreview/release-gate. Ikke likestill grønn geometri med god komposisjon.
- Test nye funksjoner gjennom faktisk UI/API/database: barn uten innlogging med profilbilde, person med flere oppdrag og feilet/aldri-kjørt/vellykket resultat, metadataendring uten modellkall eller ødelagt godkjenning, kalenderendring/avlysning/duplikat/restart, utløpt eller tilbakekalt tilgang og avvist kryss-husstandstilgang. Bruk isolerte leverandørtransporter for OAuth og kalenderdata. Vis hele nye brukerflyter i begge temaer på mobil og relevant større skjerm. UI-plassholdere og injiserte tilstander skal ikke presenteres som fungerende live-integrasjoner.
- Ny kilde krever ny kildebundet runtime/build/capture via etablerte scripts. Regenerer alle 14 ordinære latest-bilder, arkiver forrige sett korrekt. Lag `round-9/` med seks-personers Home på fem viewporter/begge temaer, berørte sider/dialoger, nødvendige 1/4/5/8-regresjoner og referanse/før/etter. Unngå overflødige dubletter. Skill faktisk isolert transport fra eventuelle injiserte stresstester.
- Oppdater offentlig testversjon via den nå verifiserte immutable Samvev-driftsveien, med gjeldende backup-/restore-/rollback-rutine og faktisk HTTPS-etterkontroll. Generell deployautorisasjon er allerede gitt. Ingen endring av Pangolin/global konfigurasjon eller andre apper. Ikke gjør om tidligere gjennomført migrasjon eller historisk restore bare for å pynte rapporten; post-deploy recoverability-bevis er ikke retrospektivt pre-cutover-bevis.
- Nye migrasjoner og eventuell bildelagring skal inngå i denne rundens backup-, restore- og rollback-plan. Verifiser gjenoppretting av database og tilhørende bildeasset samlet før de nye lagringsendringene tas i bruk offentlig. Dokumenter schema-/kodekompatibilitet ved rollback, og kontroller app/worker/database, innlogging, relevante nye flyter og SSE etter publisering.
- Offentlig testkonto kan fortsatt ha én person og begrensede rettigheter. Publiser bare egnet syntetisk bevis og merk dette tydelig; seks-personersdesign valideres separat. Skjermbilder med privat konto-/provideroppsett skal fortsatt holdes private.

Skriv ROUND_9_REPORT og påkrevd prosjektstatus. Bruk en leveransematrise for hvert bestilt punkt: implementert, testbevis, offentlig tilgjengelig, ekstern live-kontroll og eventuell konkret brukerhandling. Skill designfunn, AI-diagnose, syntetiske adaptertester, offentlige etterkontroller og uavklarte begrensninger. Oppgi ny source SHA, review SHA, faktisk deployet SHA og direkte lenker. Bevar gamle bevis med sine gamle kilder; ingen gjenbruk som påstått ny capture. Sluttsvaret skal gjøre det enkelt å prøve de nye funksjonene, og samle det eneste brukeren må gjøre selv.

DCO-signert commit/push kun til `feat/m3-family-hub`. Ingen PR, merge, main-/force-push, tag, release eller Actions-dispatch. Ikke skriv egen endelig designgodkjenning i mailboxen. Lever hele runden. En blokkert ekstern konto avslutter ikke resten av goal-et; stopp først når målet er dokumentert nådd, tilgjengelig budsjett er brukt, eller alle gjenværende arbeidsveier faktisk krever brukerinnsats. Beskriv uferdig arbeid ærlig og hva som konkret låser det opp.
