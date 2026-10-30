# Isolated display re-pair proof

From the publisher checkout root, run the API and browser proof:

```sh
./tests/e2e/display-proof/run.sh
```

To also save visual evidence, use:

```sh
./tests/e2e/display-proof/run.sh --screenshots
```

Screenshots and `manifest.json` are written to the ignored
`.local/m3/round17/visual/` directory through a checked writable bind mount. The
manifest records a stable screenshot ID, page surface, theme, requested viewport,
actual PNG dimensions, SHA-256, source HEAD and dirty state, fixture identity and
checked synthetic content. Screenshot mode produces 30 viewport captures: member
Home, paired display and admin preview in light and dark at 1920×1080, 390×844,
820×1180, 1280×752 and 752×1280. It also writes three clearly named full-page
supplements at wall landscape size and four custom-background captures (live display
and admin preview, light and dark) at 1280×752. No screenshot is captured from a
mocked UI or a direct DOM replacement.

The admin preview uses its real page at the requested viewport, with display
orientation set to match. The capture blurs the active control so a focus ring or
skip-link overlay is not included. Home, display and preview captures wait for
visible loading text to clear before taking images.

The script creates a uniquely named, internal network and a PostgreSQL container with a temporary filesystem under Compose project `samvev-m1`. It verifies the database container's project, service, mounts and lack of published ports, then verifies the database identity and emptiness before migration and synthetic fixture writes. It deletes only its own labelled containers and network on exit. It does not use the shared development, test or QA databases. The existing workspace dependency volume is mounted read-only by the isolated API; no dependency installation occurs.

The API reads the current publisher checkout, and the browser container builds the current web source and serves it locally. Browser API requests are intercepted and forwarded to the isolated API. Three browser contexts exercise approval and redemption: the existing display stays authorized after approval, loses access after redemption, and the replacement receives access. The proof checks that the registration, setup and person grants remain unchanged. It also compares preview and live projections and rendered UI for two synthetic adults, four selected synthetic children, a school activity today and a school trip tomorrow. Normal screenshots are captured while the synthetic household has exactly those six people. After image capture, a seventh synthetic child is added as an unselected ACL fixture with a targeted synthetic message; both must be absent from preview/live API projections and their rendered UI. Member Home shows a synthetic household note and author avatar. The fixture retains a separate person-targeted school notice for the ACL check. The paired display receives explicit read-only grocery and dinner grants; its preview and live projections must show the synthetic board items while board write actions remain denied. The second synthetic display has no board read grant, and its projection and rendered UI must hide the same items. A repository-bundled landscape is resized with Sharp for the synthetic album card and selected as a synthetic display background with explicit household and paired-display read grants. The second display with no background grant and the revoked old credential cannot read it. No household photo is introduced. Synthetic meal content uses test-only strings.

Screenshot mode captures member Home, paired screen and manager preview after checking that the live UI loaded its synthetic content. It does not create a profile photo for a person or Home Assistant/environment readings; no HA sensor is seeded. The six people and message author use the repository's bundled illustrative avatars.

Before running, screenshot mode accepts an empty output directory or a prior complete screenshot set whose manifest inventory and PNG hashes verify. It rejects unexpected, missing, nonregular or unmanifested pre-existing entries and does not delete unknown files. After capture it checks that every persistent file is either a manifest-listed PNG or `manifest.json`; the exact temporary landscape filename is removed by cleanup.

Before each paired-display and preview screenshot, the proof waits until the exact synthetic Today and Tomorrow activities remain present together for a bounded stable window; a missing event, disabled-calendar fallback or loading placeholder fails the proof. It then pauses that browser page's Playwright clock for the capture, repeats the checks immediately before and after the screenshot, and resumes the clock. It checks that each member Home screenshot contains exactly six primary synthetic people. The custom-background screenshots record the selected asset and household/display read grants in the manifest.

The script requires the existing `samvev-m1/workspace:local` and `samvev-m1/browser:local` images, `postgres:17.11-bookworm`, and `samvev-m1-workspace-node-modules` volume. Their dependencies are not verified against the current lockfile. Browser locale and timezone are pinned to Norwegian Bokmål and Europe/Oslo where browser context settings apply; server fixtures use the household's Europe/Oslo timezone. The screenshot timestamp itself is informational. This is a browser simulation, not a test on a physical wall display. All fixture names, credentials and data are synthetic and test-only.
