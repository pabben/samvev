# Samvev M3 – designrunde 4: familiepreg og materialer

Passiv mailbox. Utfør først når brukeren ber Codex om å aktivere denne filen. Når aktivert: fullfør denne avgrensede runden autonomt, inklusive visuell iterasjon, relevante tester, nytt review-sett og push til featurebranchen. Work er design-/produktreviewer; Codex implementerer.

## Grunnlag

- Repository: pabben/samvev
- Branch: feat/m3-family-hub
- Review/head før denne mailbox-commiten: e236413cb19c76b5770eb4070e1b8d869040aab2
- Vurdert source SHA: da31a7d757d81b4a8308b9a41f6239c2367d3952
- Round ID: 20260930182826-da31a7d7-1886d5b2
- Forrige vurderte source: 99185975a758548dacbe11210834c9fbd9a06c55
- Forrige review SHA: aa416f25bd7daeca8155593c23965072e263176e
- Forrige round ID: 20260930035832-99185975-5a933bde

Work har faktisk sett begge autoritative referanser og alle 14 bilder fra runde 3, samt sammenlignet relevante bilder fra runde 2. De 14 PNG-filenes dimensjoner og SHA-256 samsvarer med manifestet. Referansenes Git-blobber er uendret. Runtime-/testpåstander kommer fra ROUND_3_REPORT.md; Work har ikke selv kjørt LAN-testene.

Vurdering: 7,5/10 visuell referanseparitet, opp fra 7/10. Ingen ny P0 er dokumentert. Komposisjonen godkjennes som utgangspunkt for videre arbeid; høy visuell referanseparitet er ikke ferdig oppnådd.

Runde 3 har løst hovedproblemet under I morgen på mørk desktop og iPad portrait. Familiemeldingen har bedre avsender-/teksthierarki, og detaljkontrollene er forståeligere. Mobil beholder tre komplette dagsplanrader. Disse forbedringene skal beholdes.

Neste runde er én avgrenset art direction-/materialrunde med én konkret justeringsfeil. Ikke bygg om grid eller flytt seksjoner på nytt for marginal gevinst. Etter denne runden leveres et samlet resultat til brukerens designreview; ikke start en ny selvbestilt designrunde.

Les AGENTS.md, docs/design/review/README.md, latest/manifest.json, ROUND_3_REPORT.md og denne filen. Følg relevante prosjektroller med én integrator og sekvensielle skribenter. Bevar hovedcheckoutens beskyttede .git og bruk etablert .local/design-review-publish til Git-operasjoner. Arbeid bare i /home/administrator/apper/samvev og eksisterende isolerte samvev-m1 QA-ressurser. Hent siste featurebranch, bevar uvedkommende arbeid og ikke reset/repoint/unlock beskyttede metadata.

## Autoritative originaler og vurderte screenshots

- docs/design/ChatGPT Image 24. sep. 2026, 23_51_09.png
- docs/design/ChatGPT Image 24. sep. 2026, 23_52_06 (4).png

Originalenes appflater er visuell fasit. Eldre mockups/SVG-er overstyrer dem ikke. Ikke kopier skjermrammer, rom, markedsføringstekst, navnet FamilieOS eller konkrete eksempeldata. Produktet heter Samvev.

Vurderte viewport-filer under docs/design/review/latest/:

| Størrelse | Lys | Mørk |
|---|---|---|
| 1920×1080 | desktop-1920-light.png | desktop-1920-dark.png |
| 390×844 | mobile-light.png | mobile-dark.png |
| 820×1180 | ipad-portrait-light.png | ipad-portrait-dark.png |
| 1180×820 | ipad-landscape-light.png | ipad-landscape-dark.png |
| 1280×752 | shelly-1280-light.png | shelly-1280-dark.png |

Full-page supplementer:
- desktop-1920-light-full.png – 1920×1302
- desktop-1920-dark-full.png – 1920×1202
- mobile-light-full.png – 390×2687
- mobile-dark-full.png – 390×2700

Viewportene er primære. Full-page mobilens fixed-nav-stripe er et kjent capture-fenomen, ikke alene en runtime-feil. Shelly viser member Home ved den oppgitte størrelsen; dette er ikke fysisk Shelly-/paret-display-sertifisering.

## Prioritering og konkrete endringer

### P0 – ingen nye funn

Bevar dagens førsteside og responsive struktur. Ikke konstruer nye blokkerende avvik fordi et kort har mindre innhold enn nabokortet. Det åpne feltet ved den nederste mørke huskelisten trenger ikke fylles.

### P1.1 – Lys modus trenger tydeligere familiepreg

Største gjenværende forskjell er art direction. Referansen har levende personområder, lys himmelfølelse, organiske aksenter og vennlige innholdsikoner. Dagens lyse flate har riktige pasteller og en god struktur, men uttrykket bæres nesten bare av initialer over hvite kort og en beige/grønn gradient.

Gjør en samlet, begrenset forbedring:
- Behold personfargene blå/rosa/mint/lavendel, dagens kortstørrelser og navn-/innholdshierarki. Gi identitetsfelt og avatar en gjennomarbeidet, myk materialitet uten lysende ringer, kraftig glød eller større kort.
- Gi bakgrunnen ved hilsen og personområde mer av referansens lyse blå/mint atmosfære, med varm off-white leseflate og en svært diskret organisk form/lysfordeling mot ytterkantene. Unngå at hele siden bare blir mer mettet eller mer beige. Hold tekstsonene rolige.
- Løs dette primært med eksisterende lokale ressurser og CSS. Ingen ny ekstern asset-/fonttjeneste, runtime-avhengighet eller separat bildeproduksjonsprosjekt.
- Familiemeldingen skal beholde sin nå bedre prioritering, naturlige høyde og moderate linjelengde. Ikke gjør den tilbake til en sekundær administrativ statusboks.
- Initialer er fortsatt en gyldig fallback. Manglende illustrerte personavatarer er en ærlig restforskjell mot referansen. Ikke lag oppdiktede ansikter knyttet til navn, hardkod demobilder eller innfør avataropplasting/datamodell bare for å oppnå et penere screenshot.

Akseptanse: på lys desktop er den samlede atmosfæren tydelig lettere og mer familievennlig enn runde 3, samtidig som personnavn og innhold fortsatt er mest fremtredende. Den samme material-/fargefamilien finnes på mobil og nettbrett uten ekstra dekorativ høyde.

### P1.2 – Mørk modus: tydeligere glass, roligere blå masse

Landskapet og den nedtonede forgrunnen er forbedret. Selve panelene oppleves fortsatt mer som jevnt blå, solide kort enn den mørke referansens lagdelte glass.

- Behold nordic-dusk-v2, utsnittets hovedidé og nederste navy-overlegg. Ikke bytt bakgrunnsasset eller bygg om plasseringen.
- Juster hovedpanelenes materialer med en kontrollert mørk toning, svært diskret lysgradient/refleksjon og en fin lyskant. La bakgrunnens lys påvirke glasset moderat; ikke senk opacity globalt til fjell og kontrastfelt konkurrerer med tekst.
- Skill hovedglass, innvendige påminnelseskort og menneskelig meldingsflate med rolige materialforskjeller. Unngå at alle lag får samme blå flate eller at alle kanter lyser likt.
- Begrens ekstra blur og skygger. En lesbar fallback uten backdrop-filter skal beholde både hierarki og kontrast. Ingen animert glans eller tung effekt på mobil/Shelly.

Akseptanse: i side-ved-side-kontroll er det synlig forskjell mellom bakgrunn, hovedglass og innvendig kort. Uttrykket er dypere navy og mindre jevnt blått enn runde 3, uten tapt lesbarhet eller bakgrunnsatmosfære. Vurder endringen på faktisk bildebakgrunn i begge store og små viewporter.

### P2.1 – Samlet typografi- og ikonkarakter

Typografi og små outline-ikoner er fortsatt mer generelle og administrative enn referansene. Semantiske farger er allerede innført i runde 3; viderefør dette, ikke etabler en ny konkurrerende ikonstil.

- Bruk eksisterende font-/ikonressurser. Samordne fontvekt, linjehøyde, ikonstørrelse og optisk plassering i hilsen, personområder, agenda og støttewidgets. Navn, aktiviteter og meldingsbudskap skal komme før metadata.
- Gjør de eksisterende semantiske ikonaksentene litt tydeligere der det gir reell lesestøtte. Unngå farget bakplate på hvert ikon eller en regnbue av dekor.
- Velg ikoner fra faktisk strukturert innholdstype. Ikke utled «fotball», «middag» eller personlighet fra hardkodede demotitler. Kalender er riktig fallback når bare typen avtale er kjent.
- Behold lokalisering, klokke/tidssone, kontrast og rolige metadata. Ikke legg til håndskriftfont, nye slagord eller dekorative innholdskort.
- Bevar Samvev-logo, navigasjon, handlinger og gode radius-/spacing-proporsjoner.

Akseptanse: ikoner og tekstnivåer virker som ett sammenhengende system i begge temaer. Endringer skal kunne vises konkret i før/etter, ikke bare beskrives som «premium». Typografiske justeringer må ikke gjøre at dagens gode førsteside mister innhold.

### P2.2 – Rett avatarens sentrering ved «Detaljer»

I lys iPad landscape og Shelly skyver den bredere Detaljer-kontrollen avatarene i personkort med kontroll til venstre for navnets/kortets senter. Dette sees på Morgan og Robin i dagens fixture; kort uten kontroll har sentrert avatar.

- Sentrer identitetsgruppen konsekvent i kortets fulle bredde når denne kortvarianten skal være sentrert. Kontrollens tilstedeværelse skal ikke forskyve avatarens optiske akse.
- Behold synlig og lokaliserbar «Detaljer»/«Details», minst 44×44 trykkflate, klar avstand og forståelig fokusrekkefølge.
- Bruk en robust løsning for smale kort og lengre oversettelser; ingen absolutte fixture-koordinater, overlapp eller tilbakegang til tvetydige tre prikker.
- Kontroller også desktop og øvrige kortvarianter. Mørke kompakte personrader skal fortsatt være venstrejusterte; ikke sentrer alle avatarer globalt.

Akseptanse: ved 1180×820 og 1280×752 ligger avatar, navn og sentrert metadata på samme vertikale akse, både med og uten detaljkontroll. Detaljknappen er tydelig, treffer riktig innhold og kolliderer ikke med lange navn.

## Behold funksjon og responsive resultater

- Ingen ny seksjonsrekkefølge, flytting av widgets, tvungen lik panelhøyde eller større hero. Behold observasjonen under I morgen der runde 3 grupperer den. Ikke dupliser støtteinnhold.
- 1920×1080: behold hovedinnhold, begge påminnelser, den korte menneskelige meldingen og minst én reell støttewidget i første viewport.
- 390×844 med runde 3s innholdsmengde: alle fire navn, begge påminnelsestitler/mottakere og tre komplette dagsplanrader før bunnavigasjonen, med klaring. Navigasjonen og dens trykkflater beholdes. Naturlig scrolling er riktig for ekstra innhold.
- 820×1180: behold todagersområdet med eksisterende støtteinnhold i høyrekolonnen og familiemelding før detaljerte personkort.
- 1180×820 og 1280×752: behold alle fire navn med minst én komplett reell opplysning per person, en komplett dagsplanrad, begge viktige titler/mottakere og en kort menneskelig melding med avsender.
- Førsteviewport-krav er innholdsbaserte regresjonsgrenser, ikke krav om å bevare utløpte avtaler. Klokke/dag/utløp skal virke naturlig. Ikke redater, reseed, endre klokke eller opprett innhold for capture. Dokumenter naturlige forskjeller; hvis for lite reelt QA-innhold hindrer rutinen, bevar siste gyldige sett og rapporter den konkrete blokkeringen.
- Behold hovedtekst rundt 16 px eller større, lesbar metadata, minst 44×44 trykkflater, synlig tastaturfokus og reduced-motion. Ingen zoom, klipping eller mindre tekst for å bestå geometri.
- WCAG AA på faktisk kompositerte flater, også etter endret gradient/glass. Informasjon skal ikke avhenge av farge alene; dekor skal ikke bli støy i tilgjengelighetstreet.
- Ingen horisontal side-overflow med 1/4/8 personer, lange navn/tekster eller tomtilstander. NB/EN, light/dark/system og native zoom skal beholde innhold og handlinger.
- Behold «1 til» som beregnet antall skjulte oppføringer, påminnelsens ene detaljknapp, full tekst/kilde og persondialoger. Behold runde 3s retting av åpne kildeopplysninger og fokus ved regrouping, samt dialogenes oppdatering/lukking ved endret eller utløpt innhold.
- Behold startsAt-basert daginndeling, SSE, offline/utløp, rolle-/displaygrenser, render acknowledgments, kilde/proveniens og skillet mellom menneskelig melding og generert oppsummering.
- Ingen API-/auth-/datamodellendring, migrasjon eller ny produktfunksjon. Behold testinnlogging admin/admin og eksisterende ordinære passordverifisering. Ikke implementer eller kjør passordendringen på nytt i et allerede fungerende miljø.

## Gjennomføring og validering

1. Åpne begge originalreferanser og bildene fra runde 3 før endringer. Fullfør de fire prioriterte områdene samlet. Iterer på faktisk visuell kontroll; ikke stopp ved første CSS-justering. Hvis et foreslått materialgrep gjør resultatet dårligere, juster eller forkast det og dokumenter hvorfor.
2. Kjør i eksisterende Node 24-miljø:
   - npm run check --workspace @samvev/web
   - npm run test --workspace @samvev/web
   Test endret atferd hvis nødvendig; ikke lag tester som bare speiler CSS.
3. Før nettleser-QA: lag DCO-signert source-checkpoint i canonical publishing-checkout. Gjør QA-worktreets build-inputs byte-identiske og kjør bash scripts/design-review-build.sh. Bruk akkurat denne kandidaten og verifiserte LAN-assets i nettleseren.
4. Kjør eksisterende målrettet nettleser-QA i begge temaer/alle fem størrelser. Kontroller førsteside, overflow, 44px-kontroller, Axe, faktisk kompositert tekstkontrast, fokus og detaljåpning. Nye bakgrunner/glass krever nye kontrastmålinger; tidligere verdier er ikke automatisk gyldige. Verifiser materialfallback uten backdrop-filter. Kontroller berørte NB/EN-etiketter, lange navn, zoom og smale kort.
5. Bevar regresjonsdekningen for tema/rotasjon, kildeopplysningenes åpne tilstand/fokus og dialoglukking/oppdatering. Gjenbruk de målrettede kontrollene fra runde 3. Ingen ny bred testinfrastruktur for denne poleringen.
6. Gjør én faktisk UI-smoke med admin/admin på http://192.168.0.220:4173: ordinær innlogging, Home, utlogging. Gjenopprett midlertidige tema-/språkpreferanser.
7. Full muterende M3-harness er ikke standard ved ren material-/CSS-polish. Kjør bare hvis konkret endret funksjonslogikk eller relevant repo-gate krever det, og begrunn. Review-tooling holdes uendret; hvis en nødvendig toolingfeil faktisk må rettes, kjør node --test scripts/design-review-publication.test.mjs scripts/design-review-provenance.test.mjs.
8. Ingen bred reset, ny provisioning, bash scripts/m1.sh qa-test, npm ci/install, global installasjon, broad prune/down eller Actions-dispatch under denne runden. Behold eksisterende healthy QA-tjenester.
9. Når kandidaten er stabil, verifiser samsvar mellom siste testede source-checkpoint, build-proof, arbeidsfiler og serverte assets. Ved kildeendring: nytt checkpoint/build og berørte kontroller. Kjør deretter fra prosjektroten:
   - bash scripts/design-review.sh
   Bygget i steg 3 er produksjonsbuild-kontrollen. Ingen ekstra build etter capture som ugyldiggjør proof.
10. Regenerer alle 14 filer med de eksisterende navnene og viewportene ovenfor; full-page-høyder er innholdsstyrte. Åpne alle bildene faktisk, sammenlign mot originalene og runde 3. Kontroller ny source SHA, round ID, tema, dimensjoner, bildehash og serverte assets. Ved bekreftet feil: rett, nytt checkpoint/build, relevante kontroller og nytt komplett sett.
11. Bevar korrekt workingTreeDirty-rapportering og la rutinen arkivere forrige gyldige sett. Ikke erstatt ekte innloggede screenshots med browser-mock/stressbilder.
12. Skriv ROUND_4_REPORT.md med konkrete før/etter-resultater, tester, endrede filer, naturlige datoforskjeller og ærlige restavvik. Bevar tidligere rapporter, arkiver, mailbox og originalreferanser. Oppdater nødvendig prosjektstatus etter repoets rutine.
13. Commit relevante UI-/test-/dokumentasjonsendringer og validert evidence med DCO/sign-off. Push eksplisitt kun git push origin feat/m3-family-hub.

Ingen PR, merge, deploy, main-push, force-push, tag, release eller Actions-dispatch. Ingen private data eller nye hemmeligheter.

## Ferdigmelding og stoppunkt

Oppgi source SHA, review SHA, round ID og manifest-lenke; konkrete forbedringer per tema/skjermgruppe; restavvik; tester som faktisk ble kjørt; admin/admin-smoke; endrede filer og eventuelle naturlige fixtureendringer. Skill rapportert test-PASS fra visuell referanseparitet.

Lever hele runden til ny Work-/brukerreview når dette er ferdig. Komposisjonen er stabil; ikke start enda en ombygging av layouten. Dersom illustrerte avatarer eller annet nytt produktomfang fortsatt begrenser pariteten, dokumenter dette som en gjenværende designbeslutning fremfor å omgå avgrensningen med falskt innhold.
