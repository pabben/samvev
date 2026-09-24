# M3 Family Hub browser evidence

These images contain only synthetic local QA content. The harness signs in to the existing synthetic demo, pairs a restricted display through the normal API, creates a scoped integration credential and posts all six external item kinds. No Home Assistant, OpenAI, calendar, weather, device or push service is called.

Run from the repository root after starting the isolated `qa-app`, `qa-worker` and `qa-db` services and applying migrations:

```bash
docker compose --env-file .env.example -p samvev-m1 run --rm --no-deps qa-browser node apps/web/tests/m3-family-hub.mjs
```

The supported default origin is `http://qa-app:4173`. The harness uses the synthetic demo account and normal admin APIs; it refuses nonlocal origins. Repeated visual iterations can legitimately exhaust the login rate limit. Do not change the application rate-limit policy to run tests.

## Captures

- `mobile-{light,dark}.png`: 390×844 member Home; corresponding `-full.png` captures include the complete scrollable feed.
- `ipad-portrait-{light,dark}.png`: 820×1180 member Home.
- `ipad-landscape-{light,dark}.png`: 1180×820 member Home.
- `tv-1920-{light,dark}.png`: 1920×1080 restricted paired display; corresponding `-full.png` includes briefs/lists below the first viewport.
- `shelly-1280-{light,dark}.png`: 1280×752 restricted touch display. More content remains reachable by scrolling.
- `stress-eight-people.png`: controlled presentation fixture with eight synthetic people, a long name and long content. This fixture is separate from the preceding real API/SSE scenarios.
- `results.json`: execution time and passing checks from the completed harness run.

## Design references and actual refinement

The authoritative light PNG (`ChatGPT Image 24. sep. 2026, 23_51_09.png`) informs warm backgrounds, soft blue/rose/mint/lilac person cards, rounded surfaces and a mobile feed. The authoritative dark PNG (`ChatGPT Image 24. sep. 2026, 23_52_06 (4).png`) informs deep navy surfaces, restrained translucent borders, layered evening background, Today/Tomorrow overview and a broad family-message band. Both use the same Samvev components and semantic theme tokens. Initials are derived from people; there are no hardcoded reference names, fake weather data or device controls.

The first actual screenshots showed a 158px inherited display header, a large hero and a full-width Important section pushing useful content below the fold. Subsequent inspected iterations reduced display chrome, moved Important beside the agenda, moved full item bodies/provenance into accessible title-triggered dialogs, enlarged useful TV titles to 22–24px and placed the family message above briefs. The mobile hero was shortened so both Important cards appear in the initial viewport. The greeting now follows the household clock, including evening before 05:00. Contrast was strengthened after an Axe finding on a layered light surface. Shelly title size is asserted from the computed text style rather than the parent button style.

## Validation scope

The harness checks real POST → database → member/display SSE → DOM without navigation, withdrawal, idempotent retry, target-person grouping, event-time Today/Tomorrow, source uncertainty disclosure, NB/EN, light/dark/system changes, keyboard skip/focus, reduced motion, one-time credential reveal/revocation and no browser token persistence. It runs Axe WCAG 2 A/AA and 2.1 AA on all ten viewport/theme combinations, English system mode, eight-person stress and integration administration. It checks offline item expiry before the shared cache deadline. Unit tests additionally cover household timezone/DST boundaries, null expiry, recipient grouping and old cached projections without `hub`.

Physical Shelly hardware, real network outages, production deployment and real external integrations are outside this local evidence. Historical M1 image comparisons remain separate; these images do not overwrite their baselines.
