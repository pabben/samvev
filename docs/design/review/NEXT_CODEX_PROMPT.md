# Samvev – runde 5: referanseparitet, persondetaljer og ChatGPT-planbruk

Dette er én komplett, ny implementeringsbestilling fra Pabben, aktivert når han ber Codex utføre mailboxen. Arbeid autonomt gjennom implementering, visuell iterasjon, relevante tester og publisert review-evidence. Ikke stopp etter første CSS-justering eller med en plan alene.

## 1. Ny produktretning og grunnlag

Repository: `pabben/samvev`. Branch: `feat/m3-family-hub`.

- Branch-head ved denne bestillingen: `635c8b9bef2426cb4f6e684507838ec9fac9c897`.
- Vurdert UI/source SHA: `8cc0236b4a3dd4ce43eee36591f74e75de6f4e88`.
- Review-evidence SHA: `9a570b4932dac133222768955806a94b2cd22cf7`.
- Round ID: `20261001144432-8cc0236b-66eead31`.
- Sammenlign også med arkivert runde 3, source `da31a7d757d81b4a8308b9a41f6239c2367d3952`.

Pabbens eksplisitte retning:

1. Designet skal være så identisk med originalbildene som praktisk mulig. «8/10», «pent» og «samme stil» er ikke godkjenningskriterier.
2. Fjern footer med Samvev-logo/navn og slagord.
3. Klikk på en person skal åpne en gjennomarbeidet detaljvisning for personen.
4. Implementer bruk av AI sammen med forståelig forbruks- og kostnadsoversikt.
5. Kredittene er nå avklart som ChatGPT Work/Codex-kreditter, ikke en API-kredittsaldo. Undersøk og implementer den dokumenterte ChatGPT-planruten nedenfor; ikke bygg på antakelsen om gratis API-kall. Kontospesifikk gyldighet, tilgjengelig saldo og utløp er ikke verifisert.

Dette erstatter den tidligere mailboxens stopp ved brukerreview. Tidligere frys av grid, innholdsstyrte panelhøyder og forbud mot avatarfunksjon/API-utvidelser er opphevet i den grad denne bestillingen trenger endringene. Nødvendige komponent-, kontrakt-, server- og additive skjemaendringer er tillatt. Det er fortsatt ingen bestilling om produksjonssetting.

Les `AGENTS.md`, `README.md`, produktkrav, arkitektur, relevante ADR-er, `docs/AI_TASKS_AND_NOTIFICATIONS.md`, review-README, latest-manifest og runde-4-rapport. Følg prosjektets agentarbeidsflyt; skrivende agenter arbeider sekvensielt. Hent siste featurebranch gjennom etablert publishing-checkout. Bevar nyere arbeid og beskyttet hoved-`.git`. Ikke gå tilbake til den oppgitte SHA-en dersom nyere arbeid er kommet til.

## 2. Visuell fasit og faktisk review

Åpne og se begge originalene:

- `docs/design/ChatGPT Image 24. sep. 2026, 23_51_09.png`
- `docs/design/ChatGPT Image 24. sep. 2026, 23_52_06 (4).png`

De overstyrer eldre SVG-er/mockups. Sammenlign selve appflatene i originalenes desktop- og mobilvisninger; rom, skjermrammer og presentasjonscollage er ikke UI. Produktnavnet er Samvev. Referansenes navn, tekst og eksempeldata skal ikke hardkodes.

Work har visuelt gjennomgått begge referanser og alle 14 runde-4-bilder. Viewportene er primær evidence; full-page er supplement:

| Viewport | Lys | Mørk |
|---|---|---|
| 1920×1080 | desktop-1920-light.png | desktop-1920-dark.png |
| 390×844 | mobile-light.png | mobile-dark.png |
| 820×1180 | ipad-portrait-light.png | ipad-portrait-dark.png |
| 1180×820 | ipad-landscape-light.png | ipad-landscape-dark.png |
| 1280×752 | shelly-1280-light.png | shelly-1280-dark.png |

Supplement: `desktop-1920-light-full.png`, `desktop-1920-dark-full.png`, `mobile-light-full.png`, `mobile-dark-full.png`, alle under `docs/design/review/latest/`.

Den gamle 8/10-vurderingen vektla forbedring og ryddighet for høyt. Den er ikke en godkjenning av referanseparitet. Det største gjenværende gapet er komposisjon, kortproporsjoner, personillustrasjoner og mobiloppbygning. Fargepolering alene lukker det ikke.

Bevar forbedringene som faktisk fungerer: lesbarhet, personfarger, ID-basert detaljvalg, kildeopplysningenes tilstand/fokus, gjenkjennelig familiemelding, eksisterende mobilnavigasjon og robust zoom/fallback.

## 3. Prioritert designarbeid

### P0 – tre bærende avvik

**A. Lys hovedkomposisjon og proporsjoner.** Originalen har en tydelig hovedrad med høye personfelt og dagsplan, etterfulgt av en lavere støtte-/meldingsrad. Nåværende personkort er for brede/lave, påminnelsesbåndet og flere etterfølgende oppsummeringsrader gir en annen silhuett. Mål forholdene i referansens appflate og bygg en samlet komposisjon. La personfeltene få tydelig vertikal karakter og større identitetsområde. Samle relevant informasjon fra eksisterende påminnelser/lister/meldinger i disse hovednivåene. Reduser overdreven headerhøyde og utilsiktede mellomrom. Viktig innhold skal fortsatt være synlig eller ha en tydelig inngang til fulle detaljer.

**B. Personillustrasjoner er en hovedkomponent.** Initialer alene gjenskaper ikke originalen. Innfør et sammenhengende, lokalt sett med valgbare illustrasjonsavatarer av høy kvalitet, med et eksplisitt, lagret valg per person. Bruk eksisterende egnede ressurser eller tilgjengelig bildegenerering/lisensierte ressurser; dokumenter opprinnelse/lisens. Ikke tegn tilfeldige CSS-ansikter og kall gapet lukket. Avatarområdet i lyse personkort skal ha betydelig visuell vekt, omtrent øvre fjerdedel/tredjedel som utgangspunkt for sammenligningen. Bruk samme valgte identitet i personkort, personvelger og persondetaljer, og ved meldinger bare når faktisk avsenderidentitet finnes. Ingen automatisk antakelse om ansikt, kjønn eller alder fra navn. Initialer er fallback. Gjenbruk personadministrasjon og rettigheter for valg; ingen runtime-bildegenerering per sidevisning. Store filer må optimaliseres uten synlig kvalitetsfall.

**C. Mørk hovedkomposisjon.** Originalen har fire balanserte glasspaneler i en samlet hovedrad, deretter en bred meldingsflate og mindre støtteflate. Dagens uavhengige høyder, ekstra stabler og synlig landskap mellom dem skaper et annet dashboard. Bygg tilsvarende hovedsilhuett med Samvevs ekte Today/Tomorrow, person-/familieinnhold og støtteinnhold. Felles topp og kontrollert nederkant er tillatt på brede skjermer. En rolig tomtilstand kan beholde modulens plass; ikke oppfinn innhold eller skjul alt bak «Vis mer». Landskapet skal gi atmosfære rundt hilsenen og ligge roligere bak leseflatene. Ikke innfør falske smarthjem-, vær- eller AI-kontroller for å kopiere teksten i bildet.

### P1 – tre produkt- og kvalitetsgrep

**D. Materialer, typografi og mobilkomposisjon.** Lys trenger organiske blå/grønne bakgrunnsformer, varme leseflater, vennlig ikonografi og tydeligere typografisk karakter. Mørk trenger gjennomlysning, overlys og lagdeling med dyp navy/svart. Kalibrer border, radius, skygge, glass og avstander mot originalene som en helhet. Mobil skal følge mobilreferansenes egne komposisjoner: lys familiefeed med tydelige påminnelser/meldinger og personinnganger; mørk med kort hilsen, personer, ett relevant fokusområde, reelle hurtighandlinger og kompakt dagsplan. Unngå å stable fire komplette desktop-personkort langt ned på Home når detaljene kan åpnes direkte. Handlinger skal fungere; prioritering må styres av ekte innhold.

**E. Persondetaljer ved klikk.** Gjenbruk eksisterende `selection: {kind: 'person', id}` og `resolveHubDetail`. Nå gjør mobilens personlenker bare scroll/fokus, avatar/navn er ikke åpneknapper, og «Detaljer» finnes bare ved mer enn én oppføring. Rett alle tre forhold. Identitetsområdet med avatar/navn skal åpne personen direkte, også med null eller én oppføring. Bruk en drawer på desktop/nettbrett og et fullhøyt sheet på mobil, med tydelig avatar, navn, personfarge og lukking. Vis personens tillatte hendelser/påminnelser i forståelige grupper med full tekst, tid, sted og kilde der data finnes. Felles husstandsinnhold må være merket og ikke feilaktig tilskrives personen. En tom personvisning skal være komplett og nyttig uten oppdiktet biografi. Profilredigering vises bare med eksisterende rettigheter.

Bruk serverfiltrert Home-projeksjon og nødvendige, korrekt autoriserte utvidelser. Ikke hent bred administrativ personinformasjon til vanlig Home. Ikke eksponer e-post, kontoroller eller private felt som standard familieinnhold. Bevar ID-basert oppdatering, utløp/tapt tilgang og fokusretur. Egne hendelsesknapper skal åpne hendelsen uten samtidig personåpning; ingen nestede knapper. Identitetsinngangen er en semantisk knapp med tastaturstøtte.

**F. AI-tilkobling og ærlig forbruksmåling.** Utfør funksjonsbestillingen i avsnitt 5–6. Dette er et eget reelt produktgap, ikke pynt i Home.

### P2 og obligatorisk brukerretting

Fjern footerens «samvev.» og «Hverdagen, vevd sammen.», inkludert tom høyde/spacing. Behold Samvev-identiteten øverst og innholdets kildeopplysninger. Ikke erstatt footeren med et annet slagord.

Deretter finjusteres metadata, ikonstørrelser, baseline, subtile glød-/skyggeavvik og tomtilstander. Ikke bruk hele runden på P2 før hovedkomposisjonen er korrigert.

## 4. Responsivitet og tilgjengelighet

- 1920 desktop: referansebaserte hovedrader og proporsjoner; hilsen, familieidentitet, dagsoversikt og menneskelig kommunikasjon skal prege første viewport. Tilpass bredden/innholdsrasteret fremfor å strekke alt tilfeldig.
- 1180 landscape og 1280×752: bevar hovedstrukturen med mindre luft og færre forhåndsviste oppføringer. Ikke løs plassen med uleselig tekst eller avkuttede kontroller. Meldings-/påminnelsesinngang skal være tydelig i første viewport.
- 820 portrait: hensiktsmessig to-kolonnestruktur og eventuelt 2×2 personfelt. Ikke gjør iPad til en vilkårlig forstørret mobilfeed.
- 390×844: bruk mobilkomposisjonen beskrevet over, kompakt personvelger og direkte detaljer. Bunnavigasjon og safe areas skal fungere. Åpent sheet skal ikke gi doble navigasjonslag.
- Håndter 1, 4 og 8 personer uten hardkodet antall, falske personer eller gjemte identiteter. Ekstra innhold kan scrolle naturlig. Lengre navn/tekst, tomme dager og rik dagsplan skal fungere.
- Minst 44×44 trykkflater, synlig fokus, riktig leserekkefølge, dialognavn, fokusfelle, Escape og fokusretur. Bevar 200 % faktisk nettleserzoom, reduced-motion og lesbar fallback uten backdrop blur.
- WCAG AA for faktisk kompositerte tekst-/kontrollflater, ikke bare tokenverdier. Ikke formidle person/status bare med farge. Lokaliser all ny tekst i NB/EN.

## 5. ChatGPT-planbruk i eksisterende AI-system

Samvev har allerede ekte OpenAI Responses-provider, kryptert credential vault, lokal OpenAI-kompatibel provider, monitor/briefing/summary, varige kjøringer og tokenregistrering. Utvid disse. Ikke bygg ny generell chat, scheduler eller parallell modellmotor.

OpenAIs dokumentasjon kontrollert 4. oktober 2026 beskriver en offisiell rute for ChatGPT-planbruk i åpne, lokalt-/selvhostede apper. Samvev er offentlig AGPL-3.0-or-later og selvhostet, men den enkelte kontoens tilgang må fortsatt verifiseres. Les gjeldende dokumentasjon før implementering:

- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
- https://developers.openai.com/siwc/ui-ux-guidelines
- https://learn.chatgpt.com/docs/pricing

Ferdigstill den eksisterende `chatgpt_subscription`-providertypen. Implementer et eksplisitt valg i AI-innstillinger mellom ChatGPT-planbruk, eksisterende OpenAI API-nøkkel og eksisterende lokal provider. Ingen skjult betalt fallback. Bevar eksisterende innstillinger og credentials ved migrasjon. ChatGPT-tilkoblingen er en AI-tilkobling; den erstatter ikke Samvevs lokale innlogging eller admin/admin i syntetisk QA.

Bruk Samvevs egen dokumenterte OAuth-registrering og et stabilt host-ID. Valider state, nonce, PKCE, ID-token/utsteder/mottaker og faktiske tillatelser før aktivering. En vellykket identitetsinnlogging alene gir ikke AI-tilgang. Registrering og credentials må bindes til korrekt konto/workspace, eier og husstand og holdes adskilt fra andre registreringer. Oppbevar tokens serverbeskyttet gjennom eksisterende vault; serialiser roterende refresh slik at app/worker ikke ødelegger samme sesjon. Frakobling stopper videre kjøringer, forsøker dokumentert tilbakekalling av fornybar sesjon og fjerner lokale tokens. Følg dokumentert reautentisering og håndter avvist samtykke/utløp uten loops.

For LAN-serveren må onboarding håndtere at loopback-callback går til maskinen med brukerens nettleser. Lag en konkret, dokumentert Samvev-flyt basert på VM-guiden, med lokal autorisering og sikker overføring/import ved behov. Bevar VM-ens egen stabile host-ID ved import; laptopens ID skal ikke overskrive den. Ikke anta at `127.0.0.1` i nettleseren peker på 192.168.0.220. Ikke kopier Codex' eksisterende innloggingsfiler eller les andre prosjekters credentials. Tokens skal ikke limes inn i chat, lagres i Git eller overføres i URL/querystrings til LAN-appen.

Bruk kontoens tilgjengelige modellkatalog og den dokumenterte offentlige Responses-ruten. Planruten krever streaming og `store:false`; parseren må håndtere completion, usage, avbrudd og feil. Bare terminal `response.completed` betyr vellykket modellresultat; `response.failed`, `response.incomplete` og brutt strøm skal ikke publiseres som suksess. Forbruksfeil kan komme etter stream-start. Tilpass verktøy-/historikkformatet og utelat felter/verktøy som denne ruten ikke støtter, blant annet `max_output_tokens`, `background` og HTTP-`previous_response_id` etter dagens dokumentasjon. Behold tur-/tidsgrenser, men ikke framstill dem som garanterte token-/pengetak. Eksisterende API-nøkkelrute må beholde sin egen kontrakt. Ikke bruk private ChatGPT-endepunkter eller lat som at to ruter har identisk støtte.

Avgrens første planbruk til konto-eierens eksplisitt autoriserte Samvev-oppdrag. Andre medlemmer/barn/displays skal ikke automatisk få en generell inngang til å belaste eierens plan. Bevar aktiveringspreview for gjentakende oppdrag og serverhåndhev grensene. AI-resultater skal bruke eksisterende validering/publisering med kilde, tid, usikkerhet og mottakere. Bevar fingerprint før AI, avgrensede retries og skillet mellom AI-resultater og menneskelige meldinger.

Vis aktiv betalings-/bruksvei og riktig konto på administratorsiden, en kort førstegangsforklaring og lenke til ChatGPTs bruksinnstillinger. Ved manglende eligibility/forbruksgrense: stopp den aktuelle planruten, vis konkret tilstand og riktig handling. Ikke anta at en appgrense betyr tom kontosaldo.

Fullfør all kode, tester og onboarding før eventuell overlevering for brukerens OAuth-samtykke. Hvis live-tilkobling ikke kan verifiseres uten brukerinnlogging, merk akkurat den kontrollen som uverifisert og lever en konkret kort tilkoblingsinstruks. Ikke stopp design- eller målearbeidet av den grunn. Ikke aktiver nye betalte API-kall fordi ChatGPT-tilgangen mangler. En eksisterende autorisert Samvev-tilkobling kan brukes til en avgrenset syntetisk smoke-test; ikke start langvarig betalt QA eller nye gjentakende oppdrag.

## 6. Forbruk, kreditter og kostnadsprognose

Målet er at Pabben forstår hva Samvev bruker og hva tilsvarende bruk kan koste når eventuelle gratiskreditter er borte. ChatGPT-kreditter og API-dollar er forskjellige regnskaper. Ikke legg brukerens private saldo/skjermbilde eller kontodetaljer i offentlig repo eller fixtures. Ikke anta utløp i desember.

Utvid eksisterende `ai_usage_events` og `/ai/usage`, som nå bare har all-time summer/siste hendelser og input/output. Registrer faktisk providerforsøk, modell som ble brukt, valgt bruksvei, tidspunkt, formål, oppdrag/kjøring/turn der relevant, resultat og kjent usage. Distinkte faktiske reparasjoner/retries skal telles; samme forsøk skal ikke registreres dobbelt ved omlevering. Avvisning før providerkall må skilles fra faktisk modellbruk. Ukjent usage er ukjent, ikke null eller gratis. Bevar historiske ukjente data som ukjente.

Bygg en enkel, forståelig «AI og forbruk»-flate i eksisterende innstillinger, bare med `household.manage` og korrekt eier-/kontogrense. Vis:

1. Aktiv tilkobling/bruksvei og hvor forbruket belastes.
2. Samvevs registrerte kall/tokens i valgt periode, med fordeling på dag, modell og formål. Skill test/oppsett fra vanlig drift.
3. ChatGPT-kredittforbruk/saldo bare i den grad det finnes dokumentert, autorisert evidence. Bruk en tydelig lenke til `https://chatgpt.com/settings/usage` for kontoens fasit. Ikke skrap private kontoendepunkter. Et eventuelt manuelt saldoøyeblikksbilde må merkes med dato og omfang; annen Work/Codex-bruk gjør en beregnet rest usikker.
4. Et klart merket estimat for normal kostnad ved samme bruksmønster. Når dokumenterte ChatGPT-kredittrater og prisgrunnlag er tilgjengelige, vis beregnet kredittbehov per måned og scenario for kjøpte kreditter. Ikke bruk API-priser til å beregne ChatGPT-kreditter eller gjette hva inkludert abonnementsbruk dekker.
5. En separat «Tilsvarende API-bruk» i USD dersom modellens API-pris er kjent, som sammenligningsscenario. Dette er ikke en regning eller bevis på trukne ChatGPT-kreditter. Ukjent/ikke tilsvarende modell må merkes som ukjent, ikke tilordnes vilkårlig API-pris.

Priser og kredittrater skal kontrolleres mot offisielle kilder ved implementering og lagres med kilde, gyldighetsdato, modell/prisvariant og presise enheter. Behold historiske prissnapshots. Bruk presis heltalls-/desimalregning. Ta hensyn til faktisk rapporterte kategorier som cached input og eventuelle cache-write tokens etter den aktuelle rutens definisjon; ikke dobbelttell kategorier eller reasoning som allerede inngår i output. Samvevs egne `web.open`/`weather.forecast` er ikke automatisk OpenAI-hosted verktøyavgifter.

Prognosen skal vise måleperiode og datadekning, bruke for eksempel siste 7/30 døgn inklusive nullbruksdager, og skille vanlig drift fra engangstesting. Kort/ufullstendig historikk skal merkes foreløpig eller ikke gi prognose. Ikke lov bestemt januarkostnad eller anta at framtidige priser/abonnement er uendret. NOK kan bare vises med oppgitt valutagrunnlag; ikke bland valutaer. En kostnads-/kredittprognose må aldri presenteres som et håndhevet pengetak.

Dette krever ikke en ny faktureringsplattform, innsamling av OpenAI-organisasjonens adminnøkkel eller salg av Samvev-kreditter. Bevar lokale providere som eget bruksgrunnlag. Oppdater eventuell utdatert dokumentasjon som hevder at ChatGPT-planbruk generelt er umulig, med dokumentert status og faktiske begrensninger.

## 7. Hva som skal bevares

- Samvev-navn, reelle person-/husstandsdata, NB/EN, light/dark/system, eksisterende funksjonelle integrasjoner og ordinær autentisering.
- Serverfiltrert Home, ADR0020s display-grants, barn-/husstandsgrenser, kilde/proveniens, SSE, utløp og offlinehåndtering.
- Ingen falske væretall, avtaler, progresjonsstreker, AI-biografier eller meldinger for å fylle designet.
- Eksisterende syntetisk QA og fungerende admin/admin. Ikke kjør passordreset, reprovisionering eller reseed uten konkret behov. Ingen private data i repo/evidence.
- Additive migrasjoner for det som faktisk trengs, med rollback-beskrivelse som bevarer data. Ingen sletting av historikk eller credentials som sideeffekt.
- Arbeid bare i prosjektets tillatte område og Compose-prosjekt. Ingen host-global konfigurasjon eller endringer i andre prosjekter.

## 8. Akseptanse og målrettet verifikasjon

Runden er ikke ferdig bare fordi testene er grønne. Åpne originale og nye appflater side om side. Vurder først silhuett, kortproporsjoner, personidentitet, glass/bakgrunn og mobilstruktur, deretter detaljene. Lag gjerne et lokalt sammenligningsark med normalisert appbredde; ikke endre originalene eller bruk en automatisert bildescore som eneste fasit. Vesentlige kjente avvik skal føre til ny implementeringsiterasjon før levering, eller en presis dokumentert reell blokkering. «8/10 er godt nok» er ikke et stoppunkt.

Akseptanse:

- Lys og mørk følger sine respektive originalkomposisjoner, med reelt forbedrede proporsjoner og lokalt valgbare illustrerte identiteter. Mobilene gjenkjennes som de samme designene i referansene.
- Footer/logo/slagord er borte uten tom stripe; headeridentiteten er beholdt.
- Alle personinnganger åpner samme persons detaljer direkte, også ved 0/1 oppføring. Identitet, innhold, kilder og rettigheter stemmer. Fokus/utløp/liveoppdateringer fungerer også gjennom tema, resize og rotasjon.
- Første viewport er balansert på alle fem størrelser. Ingen clipping, unødvendige dupliserte personlister eller tapte innholdsinnganger. Test også en legitim innholdsrik tilstand med minst tre dagsplanoppføringer: dagens sparse fixture alene kan ikke bevise dette.
- ChatGPT-planruten er implementert etter dokumentert støtte, med sikker Samvev-registrering og forståelig onboarding. Uverifisert kontotilgang er eksplisitt merket. API/local-regresjoner og utilsiktet bytte av betalingsvei er utelukket.
- Forbruksmålingen skiller faktisk/ukjent/estimert, plan/API/local og test/drift. Samme bruk gir etterprøvbar prisberegning/prognose uten dobbelttelling. UI lover ikke en kjent saldo eller utløpsdato uten grunnlag.

Kjør `npm run check --workspace @samvev/web`, `npm run test --workspace @samvev/web` og relevant check/build for endrede API/contracts/worker-workspaces. Følg faktisk registrerte scripts. Kjør målrettede provider-, AI-, person-/autorisasjons-, kontrakt- og migrasjonstester for endringene; `services/api/src/ai/*.test.ts` må inkluderes eksplisitt dersom gjeldende testglob ikke tar dem med. Bruk isolert testdatabase, ikke destruktive tester mot bevart QA.

Meningsfulle nye tester skal dekke OAuth-validering/avvist scope, konto-/husstandsisolasjon, samtidige refresh-forsøk, frakobling/limit uten betalt fallback, streaming usage/avbrudd, ukjent usage, idempotent registrering, prisvariant/cache/reasoning uten dobbelttelling, historiske priser og prognose med nullbruksdager/lite historikk. Bruk injiserbar transport i automatiserte tester, ikke ekte betalte modellkall.

Nettleser-QA: persondrawer/sheet med 0/1/mange oppføringer, tastatur/fokus, langtekst, 1/4/8 personer, tema/rotasjon, relevante M3-regresjoner, Axe og faktisk kontrast/zoom/fallback på endrede flater. Verifiser avatarvalg gjennom den faktiske brukerflyten, reload og identisk valgt avatar i Home/persondetaljer. Det er tillatt å velge og lagre illustrasjonsavatarer for de eksisterende syntetiske QA-personene for denne nye funksjonen; dokumenter dette avgrensede valget og vis resultatet i review-bildene. Øvrig lagret innhold skal bevares. Datamengdevarianter skal være syntetiske isolerte testtilstander; ikke redater eller reseed lagret LAN-innhold for penere screenshots. Kjør etterreview og release-gate etter prosjektinstruksene; ikke gjenta brede tester uten konkret behov.

## 9. Capture, rapport og leveranse

Bruk etablert `.local/design-review-publish`; hovedcheckoutens `.git` er beskyttet. Lag DCO-signert source-checkpoint, gjør QA-build-inputs byte-identiske, og kjør `bash scripts/design-review-build.sh` før kandidatens endelige nettleser-QA. Backendendringer/migrasjoner må også være aktivt lastet i isolert QA og samsvare med dokumentert source; en ren web-build beviser ikke dette. Bruk prosjektets avgrensede QA-prosedyre og bevar databasen. Dette gir ingen tillatelse til produksjonsdeploy.

Etter ferdige endringer og stabil kandidat, kjør:

```bash
bash scripts/design-review.sh
```

Regenerer, åpne og kontroller alle 14 navngitte latest-bilder. Arkiver forrige gyldige sett, og kontroller source SHA, round ID, dimensjoner, bildehasher, byggebevis og faktisk serverte assets. Full-page er supplement. Ingen ny build etter capture uten ny QA/capture.

Ta i tillegg screenshots av persondetaljer og AI-/forbruksinnstillinger i light/dark på desktop og mobil. Legg supplerende evidence separat under eksempelvis `docs/design/review/round-5/`, med kilde-SHA/viewport/tilstand og syntetiske data. Bevar latest-kontrakten med de 14 ordinære bildene. Ikke publiser ekte kontoidentitet, saldo, tokens eller OAuth-koder. Dokumenter hvor en skjerm bruker injisert testtransport fremfor bekreftet live-tilkobling.

Skriv `docs/design/review/ROUND_5_REPORT.md` og oppdater prosjektstatus som repoet krever. Ta med viktigste visuelle endringer, faktiske funksjonstester, endrede filer, migrasjon/rollback, gjenværende referansegap, kontospesifikke blokker og en kort konkret brukerhandling for eventuell ChatGPT-tilkobling. Ikke påstå at live-tilgang er testet dersom bare mocks er brukt. Behold QA-tjenestene healthy og admin/admin fungerende.

Commit med DCO-signoff og push kun featurebranchen:

```bash
git push origin feat/m3-family-hub
```

Rapporter source SHA, review SHA, round ID og lenker. Ingen PR, merge, deploy, main-push, force-push, tag, release eller Actions-dispatch. Ikke overskriv mailboxen med en ny designgodkjenning; Work gjør neste review etter at evidence er pushet.
