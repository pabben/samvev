# Samvev M3 – designrunde 3: samlet komposisjon og tydelige detaljer

Passiv mailbox. Utfør først når brukeren ber Codex om å aktivere denne filen. Når aktivert: fullfør hele runden autonomt, inklusive visuell iterasjon, relevante tester, nytt review-sett og push til featurebranchen. Work er design-/produktreviewer; Codex implementerer.

## Grunnlag og retning

- Repository: pabben/samvev
- Branch: feat/m3-family-hub
- Review/head før denne mailbox-commiten: aa416f25bd7daeca8155593c23965072e263176e
- Vurdert source SHA: 99185975a758548dacbe11210834c9fbd9a06c55
- Round ID: 20260930035832-99185975-5a933bde
- Forrige vurderte source: 11d43fd93c6a0be4f7d37978071866c237629c91
- Forrige round ID: 20260930021038-11d43fd9-727d21a4

Work har faktisk åpnet begge autoritative referanser, alle 14 nye screenshots og relevante sammenligningsbilder fra forrige runde. Alle 14 PNG-hasher og dimensjoner er kontrollert mot det nye manifestet. Referansenes Git-blobber er uendret.

Vurdering: 7/10 visuell designparitet, opp fra 6/10. Forrige rundes konkrete P0-problemer på lave skjermer er løst. Ingen ny P0 er dokumentert. Dette er ikke endelig godkjenning av høy referanseparitet: det gjenstår tydelige P1-avvik i komposisjon og oppdagbarhet, i tillegg til P2-polish.

Les AGENTS.md, docs/design/review/README.md, latest/manifest.json, ROUND_2_REPORT.md og denne filen. Følg relevante prosjektroller med én integrator og sekvensielle skribenter. Bevar hovedcheckoutens beskyttede .git og bruk etablert .local/design-review-publish til Git-operasjoner. Arbeid bare i /home/administrator/apper/samvev og eksisterende isolerte samvev-m1 QA-ressurser. Hent siste featurebranch, bevar uvedkommende arbeid og ikke reset/repoint/unlock beskyttede metadata.

## Visuell fasit og vurdert evidence

Autoritative originaler:
- docs/design/ChatGPT Image 24. sep. 2026, 23_51_09.png
- docs/design/ChatGPT Image 24. sep. 2026, 23_52_06 (4).png

Originalenes appflater er fasit for komposisjon, proporsjoner, kort, materialer, typografihierarki og familiepreg. Eldre SVG-er overstyrer dem ikke. Ikke kopier montasjens skjermrammer, rom, markedsføringstekst, FamilieOS-navn eller eksempeldata. Produktet heter Samvev.

Vurderte viewport-filer under docs/design/review/latest/:

| Størrelse | Lys | Mørk |
|---|---|---|
| 1920×1080 | desktop-1920-light.png | desktop-1920-dark.png |
| 390×844 | mobile-light.png | mobile-dark.png |
| 820×1180 | ipad-portrait-light.png | ipad-portrait-dark.png |
| 1180×820 | ipad-landscape-light.png | ipad-landscape-dark.png |
| 1280×752 | shelly-1280-light.png | shelly-1280-dark.png |

Supplementer:
- desktop-1920-light-full.png – 1920×1312
- desktop-1920-dark-full.png – 1920×1196
- mobile-light-full.png – 390×2705
- mobile-dark-full.png – 390×2705

Viewport-bildene er primære. Full-page mobil har det dokumenterte capture-fenomenet med fixed-nav ved opprinnelig viewport-grense; dette er ikke i seg selv en runtime-feil. Shelly-bildene viser member Home, ikke sertifisert fysisk eller paret display.

## Behold fremgangen fra runde 2

- Kompakt toppnavigasjon og mobilheader; fire navngitte personer og tre komplette dagsplanrader før bunnavigasjonen i dagens fixture.
- Lyst desktop/landscape: personkort og agenda begynner på samme høyde; påminnelsene bruker arealet under personkortene; melding og støttewidget ligger side om side.
- Alle fire personer, begge viktige påminnelser og familiemelding er nå synlige på lave skjermer.
- Innholdstilpassede paneler, naturlige personkort på mobil og tidligere familiemelding.
- Det lokale nordic-dusk-v2-landskapet og den klart bedre mørke atmosfæren.
- Menneskelige meldinger skilt fra genererte oppsummeringer; korrekt kilde/proveniens i detaljer.
- Eksisterende testinnlogging admin/admin. U1 er levert, ikke en oppgave som skal implementeres på nytt.
- Kilde-/build-proveniens, byte-identiske build-inputs, verifiserte LAN-assets og arkivene.

## Prioriterte endringer

### P1.1 – Komponer mørk hovedflate som en helhet

På 1920×1080 slutter I morgen omtrent ved y369, mens familiepanelet slutter ved y604. På 1180×820 er tilsvarende ca. y320 og y566. Neste rad venter på det høyeste panelet. Store tomme bakgrunnsfelt gir løse vinduer over et landskap, mens referansen har en rolig, samlet hovedstruktur.

Dette skal ikke løses ved å gå tilbake til fire like, 520 px høye paneler med tom innmat.

- Behold I dag og I morgen som tydelige naboområder og alle fire familiemedlemmer i den brede mørke komposisjonen.
- Stram inn familiens interne radrytme der det finnes overflødig plass, uten å krympe tekst eller treffe-/trykkflater.
- Bruk en bevisst kombinasjon av paneler/kolonner slik at et kort I morgen-panel kan få eksisterende støtteinnhold under seg. La faktisk innhold bestemme løsningen; unngå skjermkoordinater eller fixture-spesifikke høyder.
- Familiemelding og støtteinnhold skal danne en sammenhengende nedre komposisjon. Flytt eksisterende innhold ved behov; ikke dupliser widgets eller finn opp vær/smarthjem/aktiviteter for å fylle hull.
- Bevar meningsfull DOM-/fokusrekkefølge. Unngå visuell masonry som gjør tastaturnavigasjonen uforståelig.
- Målet er tydelige vertikale grupper og jevne mellomrom, uten dagens dominerende tomfelt under I morgen. Løsningen må også fungere med tom eller lang morgendagsliste.

### P1.2 – Balanser iPad portrait

Ved 820×1180 slutter I morgen omtrent ved y585, mens I dag slutter ved y728. Meldingen starter først ved y742. Mørk modus gjør det ubrukte feltet ekstra fremtredende med lysrefleksjonen i vannet.

- La eksisterende relevant støtteinnhold bruke høyrekolonnen, eller lag en kompakt, samlet todagers-agenda med tydelig dagsdeling ved denne bredden.
- Behold rask oversikt over navn, begge påminnelser og begge dager. Familiemeldingen skal fortsatt komme før de detaljerte personkortene.
- Ikke gjenskap tomrommet ved bare å gi I morgen mer tom padding.
- Kontroller at rotasjon 820×1180 ↔ 1180×820 bevarer innhold, åpne detaljer og fokus. Mobilens gode førsteside skal ikke endres som en utilsiktet følge.

### P1.3 – Gjør tilgang til detaljer forståelig

De korte påminnelsene har mistet synlig beskrivelse på mobil, portrait og lave skjermer. Tittelen ser ut som en vanlig overskrift. Mørke personrader viser +1, mens lyse personkort viser … også når alle forhåndsviste oppføringer allerede er synlige.

Work har kontrollert kildekoden: ItemTitle er en knapp som åpner ItemCard med full tekst/proveniens, og personknappene åpner persondetaljer. Ingen tapt funksjon er dokumentert. Avviket er at brukeren må gjette hva som kan trykkes og hva +1 betyr.

- Gi kompakte påminnelser en tydelig, diskret detaljindikator, for eksempel en konsekvent chevron i samme knapp/trykkflate som tittelen. Full tekst og kilde skal fortsatt være ett trykk unna.
- Bytt tvetydig +1 til lokaliserbar tekst som «1 til» når én oppføring faktisk er skjult. Antallet skal beregnes, ikke hardkodes.
- Når ingen oppføringer er skjult, skal en kontroll for persondetaljer kommunisere dette formålet. Ikke bruk en ren «…»-menyindikator som åpner en innholdsdialog uten forklaring.
- Unngå separate, overlappende eller nestede knapper. Bevar semantiske knapper, tydelig fokus, tilgjengelige navn og minst 44×44 CSS-px trykkflate.
- Behold kompakte forhåndsvisninger og begge viktige titler/mottakere synlig. Ikke legg all beskrivelse tilbake i mobilens første viewport og mist agendaen igjen.
- Verifiser i faktisk nettleser at påminnelsesdetaljer, skjulte personoppføringer, lukking, Escape og fokusretur virker etter tema-/størrelsesendring.

### P1.4 – Mer av den lyse referansens personlighet

Den lyse komposisjonen er blitt betydelig riktigere, men fremstår fortsatt mer nøktern og administrativ enn referansen. Navn/initialer, metadata, horisontale streker og like outline-ikoner gir begrenset variasjon. Den varme referansen har tydeligere personområder, små fargeaksenter og en mer personlig meldingsflate.

- Behold blå/rosa/mint/lavendel-koblingen. Finjuster overgangen mellom personfarget identitetsfelt og rolig leseflate, slik at kortene oppleves som personlige områder, ikke like tabellkolonner med forskjellig toppfarge.
- Gi navn, dagens relevante innhold og dato/metadata tydelig intern rangering. Unngå at metadata og mange skillelinjer konkurrerer med budskapet.
- Bruk eksisterende ikonbibliotek med få, men tydelige semantiske fargeaksenter. Samme type og person skal ha samme uttrykk på alle størrelser; ikke tilfeldig emoji-dekor.
- Familiemeldingen er bedre plassert og skal beholde sin plass i begge temaer. Gi avsender, avatar og selve budskapet mer vekt enn seksjonsoverskriften. På stor desktop: bruk en moderat linjelengde, omtrent 60–75 tegn der teksten tilsier det, fremfor én lang linje på tvers av kortet. La kortet få naturlig høyde. Tilpass dette til lav skjermhøyde uten å skyve hele meldingen ut av viewport.
- Ikke kopier referansenes konkrete tekst, oppgaver, sjekkbokser, belønninger eller bilder av navngitte personer. Ikke innfør avataropplasting eller ny funksjonalitet. Initialer er en gyldig fallback; ikke prøv å løse estetisk restavvik med oppdiktede personer eller data.
- Bevar Samvev-merket og eksisterende lokaliserbare tekster. Ingen ny fonttjeneste eller ekstern runtime-avhengighet.

### P2 – Demp bakgrunnskonkurranse og ferdigstill materialer

- Behold det nye lokale landskapet. Juster utsnitt/overlegg slik at hovedmotiv og horisont gir dybde bak topp/hovedområde, mens steinete forgrunn og nedre sekundærinnhold gradvis får roligere navy-bakgrunn.
- Ikke mørklegg hele bildet til atmosfæren forsvinner. Ikke lag nytt bildeprosjekt eller bytt ut assetet uten en konkret mangel.
- Bevar lesbare mørke kort, fin lyskant og diskret lagdeling. Unngå tung innramming og jevn gråblå masse.
- Demp gjenværende lysende avatarringer, særlig i mobilens fulle personkort. Behold tydelig identitet og kontrast.
- De to nederste støtteboksene er svært brede og like høye selv om familiebrevet har lite innhold. Gi dem innholdsstyrt høyde og mindre visuell vekt enn agenda/personer/menneskelig melding. Bevar lesbar tekst, tilgjengelig proveniens og fullstendig innhold; ikke legg inn fylltekst.
- Harmoniser radius, kantstyrke, ikonstørrelse og skygger etter at panelgeometrien er riktig. Kontroller faktisk resultat mot originalene.

## Akseptanse og responsive grenser

1. Ingen regresjon i forrige rundes P0-løsninger. Ved 1280×752 og 1180×820 i begge temaer: alle fire navn og minst én komplett reell opplysning per person, en komplett dagsplanrad, begge viktige påminnelsers tittel/mottaker og en kort reell familiemelding med avsender er synlige.
2. Ved 1920×1080: hovedkomposisjon, begge påminnelser, hele den korte familiemeldingen og minst én reell støttewidget er synlige. Mørk komposisjon fremstår samlet uten dagens store tomme felt under I morgen.
3. Ved 390×844 med dagens fixture: behold alle fire navn, begge påminnelsestitler/mottakere og tre hele dagsplanrader over bunnavigasjonen, med synlig klaring. Ved større datamengder er naturlig vertikal scrolling riktig.
4. Ved 820×1180: balansert todagersområde uten dagens store restfelt under I morgen; familiemelding fortsatt før detaljerte personkort.
5. Skjult tekst er forståelig og lett å åpne. «1 til» betyr én skjult oppføring; kontroller for andre detaljer har riktig formål. Ingen informasjon forsvinner.
6. Hovedinnhold cirka 16 px eller større, lesbar metadata, 44×44 trykkflater, WCAG AA på faktisk kompositerte flater, synlig fokus og reduced-motion. Ikke bruk skalering, zoom, tekstkrymping eller klipping for å passere viewport-krav.
7. 1/4/8 personer, lange navn/tekster og tomtilstander fungerer uten horisontal side-overflow. Samme innhold/handlinger er tilgjengelige i NB/EN og light/dark/system.
8. Behold husholdningstidssone, startsAt-basert daginndeling, SSE, utløp/offline, rolle-/displaygrenser, render acknowledgments og kilde/proveniens. Ingen endring av API-kode, datamodell eller migrasjoner, og ingen nye produktfunksjoner. Ordinære autoriserte UI-/QA-operasjoner, innlogging og midlertidig tema-/preferansevalg er fortsatt tillatt.

Ingen fixture-omdatering, ny syntetisk melding eller reseed bare for å pynte capture. Dagens klokke og utløp kan endre naturlig innhold; rapporter dette ærlig. Ikke hardkod dagens antall/navn/tekst inn i layouten.

## Gjennomføring og målrettet validering

1. Åpne originalreferansene og dagens screenshot-sett før endringer. Implementer de fem prioriterte områdene. Iterer visuelt til runden er ferdig; ikke stopp etter én CSS-justering.
2. Kjør sekvensielt i eksisterende Node 24-miljø:
   - npm run check --workspace @samvev/web
   - npm run test --workspace @samvev/web
   - Eksisterende relevante tester for seksjonsrekkefølge/personforhåndsvisning hvis disse berøres. Test faktisk endret atferd; ikke lag tester som bare speiler CSS.
3. Før nettleser-QA: lag DCO-signert source-checkpoint i canonical publishing-checkout, gjør QA-worktreets build-inputs byte-identiske og kjør bash scripts/design-review-build.sh. Nettlesertestene må treffe akkurat denne nybygde kandidaten og verifiserte LAN-assets. Bruk eksisterende målrettet nettleser-QA for begge temaer/alle fem størrelser. Kontroller geometri/overflow, tekst på faktisk bildebakgrunn, Axe, trykkflater, tastatur/DOM-rekkefølge, detaljdialoger og fokus ved tema/resize. Flyttet tekst må kontrolleres mot sitt nye bakgrunnsutsnitt; forrige kontrastmåling kan ikke automatisk gjenbrukes. Ved nye kildeendringer gjentas checkpoint/build og de berørte kontrollene.
4. Gjør én UI-smoke med bokstavelig admin/admin på http://192.168.0.220:4173, innlogget Home og utlogging. Bevar eksisterende QA-only alias/passordprosedyre og ordinær passordverifisering. Ikke endre autentisering eller kjør passordoppdatering på nytt med mindre miljøet faktisk er reprovisjonert.
5. En ny full, muterende M3-harness-runde er ikke standardkrav ved denne avgrensede visuelle runden. Kjør den hvis en faktisk endring i felles funksjonslogikk/tilganger/dataflyt krever det, eller relevant repo-gate krever det. Dokumenter hvorfor og kjør bare én gang når stabilt; verifiser admin/admin etterpå. Bevar testdekningen for dialog/fokus og responsive oppføringer gjennom målrettet QA uansett.
6. Hvis review-tooling/proveniens endres av en konkret nødvendig grunn: kjør node --test scripts/design-review-publication.test.mjs scripts/design-review-provenance.test.mjs. Ingen ny capture-infrastruktur uten påvist behov.
7. Ingen bash scripts/m1.sh qa-test, bred reset, ny provisioning under visuell iterasjon, npm ci/install, global installasjon, broad prune/down eller Actions-dispatch.
8. Når kandidaten er stabil: kontroller at siste testede source-checkpoint og build-proof fra steg 3 fortsatt samsvarer med arbeidsfiler og serverte assets. Ved avvik: gjenta checkpoint/build og berørte tester først. Kjør så fra prosjektroten:
   - bash scripts/design-review.sh
   Den eksplisitte build-rutinen i steg 3 er produksjonsbuild-kontrollen. Ingen ekstra build etter capture som ugyldiggjør proof.
9. Regenerer alle 14 filer med de eksisterende navnene og de fem viewportene. Åpne alle bildene faktisk. Sammenlign viewportene mot originalene og runde 2; bruk full-page som supplement. Kontroller ny source SHA, round ID, temaer, dimensjoner, hashes og serverte assets.
10. Ved bekreftet feil: rett, lag nytt source-checkpoint, bygg og ta nytt sett. Bevar korrekt workingTreeDirty-rapportering og arkiver forrige gyldige sett gjennom rutinen.
11. Skriv kort ROUND_3_REPORT.md med konkrete før/etter-resultater, utførte tester, gjenværende visuelle avvik og eventuelle naturlige fixtureendringer. Bevar ROUND_1_REPORT.md og ROUND_2_REPORT.md.
12. Commit relevante UI-/test-/dokumentasjonsendringer og validert evidence med DCO/sign-off. Push eksplisitt kun git push origin feat/m3-family-hub.

Ingen PR, merge, deploy, main-push, force-push, tag eller release. Ingen private data eller nye hemmeligheter.

## Ferdigmelding

Oppgi source SHA, review SHA, round ID og manifest-lenke; hva som faktisk ble bedre per tema/skjermgruppe; eventuelle regresjoner/restavvik; tester som ble kjørt; admin/admin-smoke; endrede filer; eventuelle fixtureendringer og bekreftelse på operasjonelle grenser.

Skill funksjonell test-PASS fra visuell referanseparitet. Ikke erklær høy designparitet bare fordi geometri og tester består.
