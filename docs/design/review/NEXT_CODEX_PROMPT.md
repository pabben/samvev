# Samvev M3 – designrunde 2: proporsjoner, lav skjermhøyde og admin/admin

Passiv mailbox: kjør først når brukeren ber Codex om å utføre denne filen. Når aktivert, gjennomfør hele runden autonomt med visuell iterasjon, målrettede kontroller, nytt screenshot-sett og featurebranch-push. Work gjør design-/produktreview; Codex implementerer.

## Verifisert grunnlag

- Repository: pabben/samvev.
- Branch: feat/m3-family-hub.
- Branch-head/review-commit før denne mailbox-endringen: 099059addf933c658509517fff80f376a3cab5e3.
- Vurdert source SHA: 11d43fd93c6a0be4f7d37978071866c237629c91.
- RoundId: 20260930021038-11d43fd9-727d21a4.
- Tidligere vurdert source: 390f6a6a6027e257a5250cfed1cc0517b6974bd3; baseline-runde 20260929230125-390f6a6a-76ac151b.
- Work har åpnet begge originalreferansene og alle 14 nye screenshots, sammenlignet med forrige runde og verifisert alle PNG-hashene mot manifestet.
- Samlet visuell designparitet: 6/10, opp fra 4/10. Stor strukturforbedring; fortsatt ikke visuelt godkjent som høy referanseparitet.

Les AGENTS.md, review/README.md, latest/manifest.json og ROUND_1_REPORT.md. Følg relevante repo-instruksjoner og agentroller, med én integrator og sekvensielle skribenter. Arbeid bare i /home/administrator/apper/samvev og de eksisterende isolerte samvev-m1 QA-ressursene.

Hovedcheckoutens beskyttede .git skal bevares. Bruk den etablerte canonical checkouten .local/design-review-publish til Git-operasjoner. Hent nyeste featurebranch/mailbox og bevar uvedkommende arbeid. Ikke repoint, unlock, reset, force-push eller skriv til beskyttede Git-metadata.

Manifestet inneholder nå kilde-/build-/serverte asset-hasher. workingTreeDirty=true er ikke i seg selv feil når build-inputs er identiske med checkpointet og forskjellene er dokumentasjon/evidence. Bevar denne verifiseringen.

Testdataene er ikke helt like mellom runde 0 og 1: dagens agenda har gått fra én til tre hendelser, morgendagens fra null til én etter syntetiske harness-oppsett. Vurder designendring og datamengde separat. Ikke omdater eller reseed for å få et penere screenshot.

## Autoritative referanser og vurderte screenshots

Originaler:
- docs/design/ChatGPT Image 24. sep. 2026, 23_51_09.png
- docs/design/ChatGPT Image 24. sep. 2026, 23_52_06 (4).png

Disse overstyrer eldre SVG/mockups. Se på selve appflatene i bildene. Ikke kopier skjermrammer, rommet rundt, markedsføringstekst, FamilieOS-navn eller eksempeldata. Produktet heter Samvev.

Vurdert under docs/design/review/latest/:

| Viewport | Lys | Mørk |
|---|---|---|
| 1920×1080 | desktop-1920-light.png | desktop-1920-dark.png |
| 390×844 | mobile-light.png | mobile-dark.png |
| 820×1180 | ipad-portrait-light.png | ipad-portrait-dark.png |
| 1180×820 | ipad-landscape-light.png | ipad-landscape-dark.png |
| 1280×752 | shelly-1280-light.png | shelly-1280-dark.png |

Supplementer: desktop-1920-light-full.png, desktop-1920-dark-full.png, mobile-light-full.png, mobile-dark-full.png. Disse har nå høyde 1497, 1361, 2845 og 2845 px. Viewport-bildene er primære. Full-page mobil har det dokumenterte fixed-nav capture-fenomenet; ikke utled en runtime-feil uten interaksjonstest.

Alle bildene viser medlemmenes Home. Shelly-navnet sertifiserer ikke paret display eller fysisk maskinvare.

## U1 – Eksplisitt brukerkrav: testinnlogging admin/admin

Brukeren har bedt om brukernavn admin og passord admin så lenge dette er testing. Gjør dette faktisk fungerende i det eksisterende isolerte syntetiske QA-miljøet på http://192.168.0.220:4173. Dette er et autorisert tillegg til designrunden.

Dagens SignIn i apps/web/src/main.tsx bruker type=email, og loginSchema krever e-post. Delt ny-passord-policy krever sterkere passord. Derfor er det ikke nok å endre demo-tekst eller skrive admin inn i et vanlig e-postfelt.

Bruk en smal løsning:
- I verifisert syntetisk demo/testmodus: la innloggingsfeltet godta admin som alias for eksisterende interne demoidentitet admin@demo.invalid. Gi feltet korrekt lokaliserbar etikett, f.eks. «Brukernavn eller e-post». Vanlige installasjoner beholder e-postinnlogging.
- Send det faktisk oppgitte passordet til ordinær passordhash-verifisering. Ikke lag automatisk innlogging, universell admin-fallback eller hopp over autentisering.
- Oppdater kun den eksisterende syntetiske administratorkontoens passordhash til admin gjennom en idempotent QA-avgrenset prosedyre. Verifiser korrekt Compose-prosjekt, QA-database og demo-markering/runtime før oppdatering.
- Bevar konto-ID, husstand, personer, meldinger og integrasjonsdata. Ingen reset, ny husstand eller blanket passordbytte for andre testbrukere.
- Bevar ordinære produksjonsregler for e-post/passord, onboarding, invitasjoner og passordendring. Ingen generell svekkelse av delte schemas og ingen databasemigrasjon.
- Oppdater capture, M3-harness og relevant testdokumentasjon samlet, slik at de bruker riktig testpassord og ikke gjenoppretter det gamle etter en harness-kjøring. Ved ny syntetisk QA-provisjonering skal den eksplisitte demo-only prosedyren kunne brukes igjen.
- Intern e-postidentitet kan beholdes i manifestet; forklar forskjellen fra UI-aliaset uten å kalle admin en e-postadresse.

Akseptanse: åpne den faktiske LAN-innloggingssiden utlogget, skriv bokstavelig admin / admin og verifiser innlogget Home. Verifiser utlogging og avvisning av feil passord. Kontroller at ikke-demo-innlogging og vanlig passordpolicy er bevart. Gjenta admin/admin-sjekken etter siste harness-kjøring. Rapporter at det virker; ikke bare at kode er skrevet.

## Behold det som nå fungerer

Ikke start en ny total redesign. Behold:
- Kompakt toppnavigasjon, eksisterende mål og konto-/innstillingsadgang.
- Store, tydelige personkort i lyst desktop og konsekvente personfarger.
- Selvstendige nabopaneler I dag / I morgen i mørkt desktop.
- Navngitte personer på mobil, tidligere agenda og tidligere ekte familiemelding.
- Temaspesifikke desktop-komposisjoner med felles datakilder/handlinger og riktig DOM-/fokusrekkefølge.
- Den etablerte kilde-/build-proveniens og review-arkivering.

## De fem viktigste visuelle endringene

### P0 – Rett prioriteringen på liggende/lave skjermer

Mørkt 1180×820 og 1280×752: den lange familiegruppen strekker alle fire hovedpanelene til skjermens underkant. I morgen har én oppføring og et enormt tomt felt. På mørk Shelly er Sky nederst avskåret, og familiemeldingen er utenfor viewport.

Lyst 1280×752: personkortene slutter rundt y551, mens påminnelsespanelet begynner rundt y676. Selve påminnelsene er i stor grad under skjermkanten. Dette er en prioritetsregresjon fra baseline, selv om familie og agenda er blitt mye bedre.

- Lag en bevisst komposisjon for lav tilgjengelig høyde. Komprimer familiegruppenes interne radavstander og metadata, og bryt koblingen mellom den lengste listen og alle nabopanelenes høyde.
- Behold I dag / I morgen som tydelige naboområder i mørkt tema. Bruk en kompakt oppsummering av hver persons faktiske innhold når plassen krever det, med eksplisitt antall/åpning til resten.
- I lyst tema skal agendaens høyde ikke låse området under personkortene til tom bakgrunn. Bruk dette arealet til viktige påminnelser og familiemelding.
- Begge temaer ved 1280×752 og 1180×820 skal vise alle fire navn, minst én komplett aktivitet/opplysning for hver person, en komplett dagsplanrad og lesbar tittel/mottaker for begge eksisterende viktige påminnelser. En kort, reell familiemelding med avsender skal få synlig plass i hovedkomposisjonen.
- Dette er presisering av produktprioritet utover forrige minimumskrav; ikke påstå at det gamle minimumskravet var feilet.
- Ikke løs med tekstkrymping, zoom, overflow:hidden, avklippet siste person eller skjult kritisk innhold. Ekstra vanlig detaljinnhold kan åpnes, og naturlig vertikal scrolling er tillatt ved større datamengder.

### P1.1 – Samle desktop i hovedrad og nedre widgetrad

Ny lysvisning er fortsatt en vertikal kø: person/agenda → fullbredde påminnelser → fullbredde melding → støttewidgets. Det ligger omtrent 95 px ubrukt område under personkortene på desktop. Personkort og agenda begynner også på ulike høyder.

- Juster øvre kant og innholdsrytme mellom personkort og agenda. Integrer «Alles hverdag»-tittelen uten at den skyver personkortene en ekstra rad ned.
- Reduser overflødig luft i agendaens rader og I morgen, uten å redusere lesbar tekst.
- Komponer nedre nivå som en tydelig familiemelding sammen med ett eller flere eksisterende støttewidgets. Påminnelser skal ha tydelig plass uten at alle seksjoner må oppta full bredde.
- Mørkt: reduser hovedradens høyde gjennom bedre familiegruppering. Lag bred familiemelding, omtrent to tredeler av neste rad, med en reell støttewidget ved siden av. Unngå at én oppføring i I morgen får flere hundre piksler tomt panel fordi en annen kolonne er lang.
- Lys: behold personkortdominansen, men skap referansens samlede widgetpreg under dem. Gjenværende sekundært innhold kan følge nedenfor; ikke press absolutt alt inn ved vilkårlig mye data.
- For dagens firepersoners-fixture ved 1920×1080 skal både hovedkomposisjon, påminnelser, hele familiemeldingens korte tekst og minst én reell støttewidget være synlige uten scroll.

### P1.2 – Gi mobilen mer nyttig innhold før scroll

Navnene og første agendarad er nå synlige, men første innholdspanel begynner fremdeles ved y335. Påminnelsene tar y335–618. Den første agendaraden slutter bare omtrent 6 px over bunnavigasjonen.

- Samle merke/hilsen, dato/klokke, status og Ny beskjed bedre. Reduser unødige egne rader og tomrom; behold fire navngitte personer.
- Gjør påminnelsenes metadata mindre arealkrevende og gi korte, forståelige forhåndsvisninger med fulle detaljer tilgjengelig. Behold begge viktige titler og mottakere direkte synlige.
- Med nåværende fixture: mål om minst to hele dagsplanrader før bunnavigasjonen, med tydelig luft over navigasjonen. Ikke gi 6 px tilfeldighetsmargin status som ferdig premium-komposisjon.
- Familiemeldingen skal fortsatt komme før de fulle personkortene og sekundære oppsummeringer.
- Behold iPad portrait-forbedringen. Ikke innfør ny bred sidekolonne eller press fire smale tekstkort inn i hovedvisningen på mobil.

### P1.3 – Gjenskap referansenes karakter og materialer

Mørk modus er bedre, men polygonfjell og ganske ensartede blågrå flater gir fortsatt ikke originalens atmosfære og premium glass. Lys modus er varm og ryddig, men pastellidentiteten forsvinner raskt i beige/hvitt.

- Gi mørk bakgrunn mer atmosfærisk dybde, myk horisont/lys og nyansert landskap. Foretrekk et egnet lokalt/klarert landskapsasset eller et originalt generert asset dersom verktøy finnes. Ingen eksterne bildeforespørsler fra appen og ingen nye bildeavhengigheter ved runtime.
- Integrer motivet i topp/bakgrunn og bak panelene. Ikke legg til en ny stor fotoseksjon eller bruk referansemontasjen som bakgrunn. Et nytt bilde alene løser ikke layouten.
- Differensier gjennomskinnelighet, lyskant og diskrete refleksjoner. Bevar dypt navy/svart og solid lesbar fallback uten blur.
- Lys: tydeligere lokale blå/rosa/mint/lavendel-felt og myke kortlag; behold hvite leseflater. La personfarger og eksisterende kategorier skape familiepreg.
- Materialkvaliteten må vurderes visuelt mot originalene, ikke ut fra at backdrop-filter eller en gradient finnes i CSS.

### P1.4 / P2 – Finjuster person- og meldingskort

- Behold større personidentitet og stabil fargekobling. Demp den sterke lyse/glødende avatarringen i mørk modus; den virker mer plastaktig enn referansens rolige glass.
- Bruk eksisterende personbilder dersom de støttes, ellers et godt initialalternativ. Ikke innfør avataropplasting, fabrikkert fotografi av brukere, XP eller oppdiktet progresjon.
- Tilpass kortets interne høyde til reelt innhold. Unngå lange, smale mobilkort med stort tomt felt under én aktivitet.
- Gjør avsender, budskap og tidspunkt til én samlet meldingskomposisjon. Unngå et langt tekstbånd over hele skjermbredden.
- Poler ikonaksenter, tittelhierarki, radius og skygger når geometrien er god. Ingen tilfeldig emoji-dekor eller teknisk informasjon i hovedflyten.

## Produkt og accessibility

Behold dynamiske personer/mottakere, innholdstyper, menneskelig melding versus AI-oppsummering, kilde/proveniens i detaljer, husholdningstidssone, startsAt-basert I dag/I morgen, SSE, utløp/offline, barn/display-tillatelser og render acknowledgments. NB/EN og light/dark/system skal virke.

Bortsett fra den eksplisitte QA-innloggingen er dette en visuell runde. Ingen ny generell autentiseringsarkitektur, API-kontraktendring, migrasjon, integrasjon, vær-, smarthjem-, belønnings- eller AI-funksjon. Ingen ekte private data.

- Samme innhold og handlinger skal være tilgjengelige etter temabytte, resize og rotasjon.
- Støtt 1/4/8 personer, lange navn/tekster og tomtilstander uten horisontal side-overflow.
- Normal innholdstekst cirka 16 px eller større, lesbar metadata og trykkflater minst 44×44 CSS-px.
- WCAG AA-kontrast på faktisk kompositerte flater; tydelig tastaturfokus og semantiske etiketter.
- Visuell rekkefølge må stemme med DOM-/fokusrekkefølge; dialoger og fokusretur skal overleve tema-/layoutskifte.
- Behold reduced-motion, fargeuavhengig status og plass til safe-area/bunnavigasjon.

## Gjennomføring, testing og capture

1. Les og åpne referansene og alle baseline-bildene. Implementer U1 og de prioriterte funnene. Fortsett gjennom lokale visuelle iterasjoner til runden er ferdig; ikke stopp ved første CSS-endring.
2. Kjør sekvensielt i eksisterende Node 24-prosjektmiljø:
   - npm run check --workspace @samvev/web
   - npm run test --workspace @samvev/web
   - Målrettede tester for demo-alias, faktisk passordverifisering og uendret ikke-demo-policy.
3. Kontroller begge temaer på alle fem størrelser med reell nettleser: overflow, Axe/kontrast, trykkflater, fokus, dialoger, DOM-rekkefølge og temabytte/resize. Vurder screenshotene faktisk mot originalene.
4. Kjør én samlet M3-regresjon når runden er stabil, siden innlogging og felles layout berøres. Les dokumentert harness-kommando; bruk isolert qa-browser med korrekt konfigurert LAN-origin. Gjenta bare ved en konkret bekreftet feil. Harness endrer syntetiske fixtures/tilkoblinger; registrer endringene i runderapporten og verifiser admin/admin igjen etterpå.
5. Kjør node --test scripts/design-review-publication.test.mjs scripts/design-review-provenance.test.mjs dersom capture/proveniens-kode endres, inkludert credential-tilpasning i capture. Ikke bygg ny review-infrastruktur uten påvist behov.
6. Ikke kjør den brede reset-rutinen bash scripts/m1.sh qa-test, ikke reseed under visuell iterasjon og ikke bruk supersederte M1-bildebaselines. Ingen global installasjon, broad prune/down eller Actions-dispatch.
7. Lag DCO-signert UI/source-checkpoint i canonical publishing-checkout. Sørg for byte-identiske build-inputs i den kjørende QA-worktree etter etablert rutine. Deretter fra hovedprosjektets rot:
   - bash scripts/design-review-build.sh
   - bash scripts/design-review.sh
   Den eksplisitte build-rutinen skal være produksjonsbuild-kontrollen; unngå en ekstra build som ugyldiggjør proof etter capture.
8. Åpne alle 14 nye screenshots. Kontroller ny source SHA, roundId, dimensjoner, temaer, filhash og provenance. Bevar korrekt workingTreeDirty-rapportering og sammenhold endret datagrunnlag med baseline. Ved feil: rett, lag nytt source-checkpoint, bygg og ta nytt sett.
9. La rutinen arkivere forrige gyldige sett. Oppdater en kort ROUND_2_REPORT.md med løste/restående punkter, fixtureendringer, tester og admin/admin UI-verifikasjon. Ikke overskriv historikken i ROUND_1_REPORT.md.
10. Commit kun relevante kode-/test-/dokumentasjonsendringer og komplett validert evidence med DCO. Push eksplisitt kun git push origin feat/m3-family-hub.

Regenerer alle ti viewport-filer og de fire full-page-filene med nøyaktig navnene i tabellen/listen. Behold manifest og bilder samlet. Ingen PR, merge, deploy, main-push, force-push, tag eller release.

## Ferdigmelding

Rapporter:
- Ny source SHA, review SHA, roundId og manifest-lenke.
- Bekreftet LAN-testinnlogging admin/admin etter siste harness/capture, og hvordan testavgrensningen er bevart.
- Konkrete løste og gjenværende P0/P1/P2-avvik.
- Visuell vurdering per tema/skjermgruppe adskilt fra test-PASS.
- Testresultater, endrede filer og eventuelle endringer i syntetisk datagrunnlag.
- Bekreftelse på at beskyttet .git, uvedkommende arbeid og operasjonelle grenser er bevart.

Målet er høy visuell paritet og en nyttig førsteside. Behold fremgangen fra runde 1; ferdigstill proporsjoner og materialer.
