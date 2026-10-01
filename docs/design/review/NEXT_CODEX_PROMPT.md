# Samvev M3 – review etter runde 4: klar for brukerreview

Passiv mailbox. Runde 4 er vurdert av Work. Dette dokumentet erstatter den utførte runde-4-instruksen og bestiller ikke en ny implementeringsrunde.

## Status og grunnlag

- Repository: pabben/samvev
- Branch: feat/m3-family-hub
- Vurdert source SHA: 8cc0236b4a3dd4ce43eee36591f74e75de6f4e88
- Review/head før denne mailbox-commiten: 9a570b4932dac133222768955806a94b2cd22cf7
- Round ID: 20261001144432-8cc0236b-66eead31
- Capture: 2026-10-01T14:44:32.232Z
- Sammenlignet med runde 3, source da31a7d757d81b4a8308b9a41f6239c2367d3952, review e236413cb19c76b5770eb4070e1b8d869040aab2, round 20260930182826-da31a7d7-1886d5b2.

Work har faktisk åpnet begge autoritative originalreferanser og alle 14 screenshots fra runde 4, og sett relevante sammenligningsbilder fra runde 3. SHA-256 og dimensjoner er kontrollert for alle 14 nye PNG-er. Referansenes Git-blobber er uendret.

Samlet visuell vurdering: omtrent 8/10, opp fra 7,5/10. Lys ligger fortsatt noe lengre fra sin referanses personlighet enn mørk. Dette er en skjønnsmessig designvurdering, ikke et automatisk testresultat.

Runde 4 er ferdig innenfor det bestilte omfanget. Strukturen og materialene er klare til Pabbens samlede vurdering. Dette er ikke en erklæring om full referanseparitet eller en godkjenning for produksjonssetting.

## Fasit og faktisk vurderte bilder

Autoritative referanser:
- docs/design/ChatGPT Image 24. sep. 2026, 23_51_09.png
- docs/design/ChatGPT Image 24. sep. 2026, 23_52_06 (4).png

Originalenes appflater er fasit; eldre SVG-er overstyrer dem ikke. Produktet heter Samvev. Referansenes navn, rom, skjermrammer og eksempeldata er ikke produktkrav.

Alle viewport-filer under docs/design/review/latest/ er vurdert:

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
- mobile-light-full.png – 390×2508
- mobile-dark-full.png – 390×2521

Viewportene er primære. Full-page mobilens fixed-nav-stripe er det dokumenterte capture-fenomenet. Shelly viser member Home ved 1280×752, ikke fysisk eller paret-display-sertifisering.

## Hva som faktisk ble bedre

1. Lys bakgrunn er friskere blå/mint og nærmere originalens lyse skjermflate. Myke personfelt og varme leseflater fungerer sammen uten ekstra dekorativ høyde.
2. Mørke paneler har mindre ensartet blåfarge og mer dyp navy. Hovedglass, innvendige påminnelser og menneskelig melding har tydeligere materialforskjell.
3. Avatar, navn og metadata er sentrert i lys iPad landscape/Shelly også når Detaljer-kontrollen vises. Kontrollen er fortsatt synlig.
4. Hilsen, personfarger, familiemeldingens hierarki og navigasjon er bevart. Mobil, portrait og de lave skjermene oppleves som samme produkt.
5. Tom I morgen vises som et kort, forståelig panel. Ingen synlig ny klipping, kollisjon eller tapt prioritering er funnet i de ti ordinære viewportene.

## P0/P1/P2 og gjenværende designforskjeller

### P0
Ingen ny blokkerende visuell feil er dokumentert.

### P1 – kjent paritetsgap, ikke ny automatisk kodebestilling
Den lyse originalens store illustrerte personer og menneskelige bildebruk gir en personlighet som initialer ikke gjenskaper. Dette er fortsatt det viktigste restavviket mot høy designparitet.

Runde 4 skulle bevare initialer som fallback og ikke innføre profilbilder, avataropplasting eller oppdiktede ansikter. Den avgrensningen er fulgt. Ikke gjenta flere CSS-runder og påstå at de alene lukker dette gapet. En eventuell utvidelse av personuttrykket skal bygge på Pabbens neste produktretning.

### P2 – kjente visuelle forskjeller
- Typografi og ikonbruk er fortsatt mer nøktern enn lysreferansens lekne uttrykk. Forbedringen i denne runden er moderat, mens hierarkiet fungerer.
- Mørk viser fortsatt mer landskap mellom panelene enn referansens tettere dashboard. Materialene er bedre; ikke start ny bakgrunnsproduksjon eller grid-ombygging uten ny retning.
- Rolige dager gir åpne arealer under korte agendapaneler. Dette er særlig synlig ved siden av de høyere personområdene. Det er et relevant inntrykk å få brukerens vurdering av, men ulik datamengde er ikke i seg selv en layoutregresjon. Ikke strekk tomme paneler eller finn opp innhold for å fylle arealet.

Ingen av disse punktene bestiller en ny runde nå.

## Datoskifte og bevisgrenser

Capture er tatt 1. oktober i Europe/Oslo. I dag har én hendelse og I morgen ingen; runde 3 hadde tre/én. Fire personer og ni aktive innholdselementer er fortsatt registrert i manifestet, med samme tittelhash.

At familiemeldingen starter tidligere på mobil er derfor ikke en ny layoutgevinst. Dagens screenshots kan heller ikke på egen hånd bekrefte det tidligere kravet om tre komplette dagsplanrader.

Personforhåndsvisningene viser også lagrede onsdagsoppføringer, og syntetiske tekster som «i morgen» er uendret. Dette kan påvirke hvor tidsaktuelt demoen oppleves. Det dokumenterer ikke alene en feil i dato-/utløpslogikken. Ikke omskriv meldinger, redater avtaler, endre klokke eller reseed for å pynte denne reviewen.

ROUND_4_REPORT.md dokumenterer TypeScript, 32/32 tester, målrettet nettleser-QA, 200 % faktisk nettleserzoom, fallback, kontrastmåling og admin/admin-smoke. Work har gjennomgått rapporten, men har ikke selv kjørt disse runtime-testene. De ordinære 14 bildene beviser ikke zoom/fokus/kontrastmålingen alene.

## Neste steg – instruks til Codex hvis mailboxen aktiveres

1. Les denne filen, docs/design/review/README.md, latest/manifest.json og ROUND_4_REPORT.md fra siste featurebranch gjennom etablert publishing-checkout. Bevar beskyttet hoved-.git og uvedkommende arbeid.
2. Bekreft kort at runde-4-kandidaten er identifisert med riktig source/review/round ID. Hvis branchen har fått nyere UI-evidence, oppgi dette; ikke gå tilbake eller overskriv nyere arbeid.
3. Behold kandidaten til samlet brukerreview på den eksisterende LAN-demoen http://192.168.0.220:4173. Behold eksisterende admin/admin og ordinær passordverifisering. Ingen ny passordprosedyre, provisioning eller dataendring.
4. Ikke start ny implementering, omplassering av widgets, avatarfunksjon, testing, build eller capture bare fordi denne filen er lest. Utført arbeid skal ikke gjentas. Det er ingen ny commit/push-oppgave for Codex i denne avslutningen.
5. Meld at runde 4 er ferdig innenfor bestillingen, at dokumenterte restforskjeller finnes, og at neste konkrete designrunde skal kombinere Pabbens tilbakemeldinger med Work-reviewen.

Stoppunktet følger vurderingen av denne leveransen og den avtalte samlede brukerreviewen etter materialrunden. Det er ikke en teknisk tilgangsblokkering.

## Krav som beholdes ved en senere bestilt endring

- Bevar dagens grid/sekvens, innholdsstyrte panelhøyder, personfarger, familiemelding, observasjonens gruppering og mobilnavigasjon til ny produktretning sier noe annet.
- Bevar responsive regler ved 1920×1080, 390×844, 820×1180, 1180×820 og 1280×752. Med tilsvarende innholdsmengde skal dagens førsteside ikke miste relevant innhold.
- Bevar NB/EN, light/dark/system, minst 44×44 trykkflater, lesbar tekst, WCAG AA på faktisk kompositerte flater, tastaturfokus, reduced-motion, zoom og fallback uten blur.
- Bevar detaljdialoger, beregnet «1 til», kildeopplysningenes åpne tilstand/fokus ved regrouping, datorelevans, SSE, utløp/offline, tillatelser og kilde/proveniens.
- Bevar syntetiske data og autentisering. Ingen API-/datamodell-/migrasjonsutvidelse som skjult del av estetisk polering.

Hvis det senere bestilles konkrete UI-endringer, gjelder fortsatt den etablerte sekvensen:
1. Relevante implementeringsendringer og målrettet validering: npm run check --workspace @samvev/web og npm run test --workspace @samvev/web; nettleser-QA for de berørte flatene og faktisk kontrast/fokus/zoom der endringen tilsier det.
2. DCO-signert source-checkpoint i canonical publishing-checkout, byte-identiske QA-build-inputs og bash scripts/design-review-build.sh før kandidatens nettleser-QA.
3. Etter ferdige endringer og stabil, testet kandidat: bash scripts/design-review.sh. Regenerer og åpne alle 14 filene ovenfor, med full-page som supplement. Arkiver forrige gyldige sett; verifiser source SHA, round ID, hasher og serverte assets. Ingen ekstra build etter capture.
4. DCO-signerte source-/evidence-commits og eksplisitt git push origin feat/m3-family-hub når den senere implementeringsrunden faktisk er bestilt.

Ingen av disse kommandoene skal kjøres nå som en ny rutinerunde. Ingen PR, merge, deploy, main-push, force-push, tag, release eller Actions-dispatch.
