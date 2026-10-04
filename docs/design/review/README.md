# M3 design review mailbox

Run a new local review round from the repository root:

```bash
bash scripts/design-review-runtime.sh
bash scripts/design-review-build.sh
bash scripts/design-review.sh
```

The normal review routine never resets a password. It expects the established
synthetic `admin` / `admin` login to work and fails without changing credentials
if it does not.

`design-review-runtime.sh` is the only supported runtime preparation step. It
requires the existing healthy `samvev-m1` `qa-db`, `qa-app`, and `qa-worker`
containers. It verifies their exact Compose project/service labels, images,
commands, workspace bind, read-only `.git` bind, synthetic database settings,
named PostgreSQL volume, demo-only database marker, active demo administrator,
and LAN origin. It brackets the operation with canonical source checks, runs the
additive migrator through the existing `qa-app`, then restarts only the existing
`qa-app` and `qa-worker` containers. It neither recreates nor restarts `qa-db`,
and it preserves the existing LAN port/origin configuration and PostgreSQL
volume. The ignored runtime proof records container and image IDs, restart/start
evidence, the actual leaf Node/tsx PID, start ticks and command for `server.ts`
and `index.ts`, canonical migration checksums, and matching root and publishing
checkout fingerprints.

`design-review-build.sh` is an explicit checkpoint build. It requires that exact
runtime proof and uses the committed
canonical checkout at `.local/design-review-publish`, verifies every tracked
build input mounted from this worktree against that checkout's Git blobs before
and after building, and records hashes for `dist/index.html` and every built
asset in ignored `.local/design-review/build-provenance.json`. It builds only
the existing healthy `qa-app` container's web workspace; it does not restart,
remount, reset, or change QA data.

`design-review.sh` never builds or prepares the runtime. Runtime, build and
capture share one host `flock`, so two review operations cannot overlap. Capture
first writes only an ignored staging directory. The browser verifies every dist
asset served by the app, while requiring the entry JS/CSS and every image
actually visible in the captured UI to have loaded. It uses semantic person IDs
from the Home response on every viewport, including the compact mobile layout;
an ordinary empty Today section is valid. After browser exit, the host verifies
canonical source, migrations, live leaf processes, runtime proof, dist hashes,
manifest and hashes/dimensions for exactly fourteen PNGs. Only then does it
archive and replace `latest/`. Any failure removes the stage and leaves the
previous `latest/` intact.

The commands only use the running, isolated `samvev-m1` `qa-db`, `qa-worker`,
`qa-app`, and a one-shot `qa-browser`. It captures the real synthetic member
Home using the existing `qa-app` `SAMVEV_PUBLIC_ORIGIN`; the runtime proof
requires the trusted `http://192.168.0.220:4173` origin and matching host port
binding. They do not recreate services, add fixtures, change product
content, use a remote origin, commit, push, create a PR, or trigger GitHub
Actions. Capture checks demo mode, synthetic login, Home people, the expected
Family Hub UI, themes, every proven built asset, page errors, and outbound browser
requests before publishing. Account locale/theme are restored and the session
is logged out. A failed run leaves `latest/` intact.

Read these files in GitHub for a design review:

- [`latest/manifest.json`](latest/manifest.json), followed by the fourteen
  images: [desktop light](latest/desktop-1920-light.png), [desktop dark](latest/desktop-1920-dark.png),
  [desktop light full](latest/desktop-1920-light-full.png), [desktop dark full](latest/desktop-1920-dark-full.png),
  [mobile light](latest/mobile-light.png), [mobile dark](latest/mobile-dark.png),
  [mobile light full](latest/mobile-light-full.png), [mobile dark full](latest/mobile-dark-full.png),
  [iPad portrait light](latest/ipad-portrait-light.png), [iPad portrait dark](latest/ipad-portrait-dark.png),
  [iPad landscape light](latest/ipad-landscape-light.png), [iPad landscape dark](latest/ipad-landscape-dark.png),
  [Shelly light](latest/shelly-1280-light.png), and [Shelly dark](latest/shelly-1280-dark.png).
- [`NEXT_CODEX_PROMPT.md`](https://github.com/pabben/samvev/blob/feat/m3-family-hub/docs/design/review/NEXT_CODEX_PROMPT.md),
  the passive mailbox for the next complete Codex instruction.

ChatGPT Work can use GitHub branch/image links when its repository access can
read this feature branch. If its integration supports repository writes, it may
write the next instruction to `NEXT_CODEX_PROMPT.md`; otherwise, edit that file
through the GitHub UI or paste its text into a Codex request. This routine does
not provide or assume automatic connector synchronization, and it never runs a
mailbox instruction until the user explicitly asks Codex to do so. No manual
screenshot upload or download is needed when Work can access the GitHub links.

The primary visual authorities are
[`ChatGPT Image 24. sep. 2026, 23_51_09.png`](../ChatGPT%20Image%2024.%20sep.%202026%2C%2023_51_09.png)
and
[`ChatGPT Image 24. sep. 2026, 23_52_06 (4).png`](../ChatGPT%20Image%2024.%20sep.%202026%2C%2023_52_06%20(4).png).
They supersede the conceptual SVGs in `docs/design/assets/`; requirements and
the M3 artifact notes remain supporting sources. These captures are member Home
evidence at TV/Shelly-sized viewports, not a paired-display view or physical
Shelly certification. The manifest's source SHA identifies the UI captured;
the later commit that adds the screenshots is review evidence, not that source.

Previous validated rounds move to `archive/<round-id>/`. Keep `latest/` and its
manifest together when linking a review.

Captures preserve the current synthetic data and clock: expired items disappear,
and Today/Tomorrow can change across midnight. Missing Home people cause the
command to fail rather than invent content; a natural empty Today or Tomorrow
section remains valid. Full-page mobile screenshots retain
the actual fixed navigation bar at the original viewport boundary, which can
cover a small strip. Work should use the viewport images together with the
full-page supplements. Runtime preparation applies only the repository's
canonical additive migrations. Revert the tooling commit to remove this routine;
retain the QA database and its migration history.

Check the publication safeguards locally with:

```bash
node --test scripts/design-review-publication.test.mjs
node --test scripts/design-review-provenance.test.mjs
```

After reviewing a new round, stage the validated review files, commit with DCO
sign-off, and explicitly push only the feature branch:

```bash
git add docs/design/review scripts/design-review-runtime.sh scripts/design-review.sh scripts/design-review-build.sh scripts/design-review.mjs scripts/design-review-provenance.mjs scripts/design-review-provenance.test.mjs scripts/design-review-publication.mjs scripts/design-review-publication.test.mjs
git commit -s -m "docs(design): add M3 review round"
git push origin feat/m3-family-hub
```

Those are manual operator steps; this command does not commit, push, open a PR,
or trigger Actions.

For a new UI round, first copy all intended source and review-pipeline changes
into the canonical publishing checkout and create its DCO-signed source
checkpoint. Then make the root build inputs byte-identical to that checkpoint,
run the explicit build command above, run capture, inspect the committed image
links, and create the later evidence commit. The source SHA identifies rendered
code; the evidence commit only carries screenshots. The routine reads canonical
checkout metadata with a command-scoped Git work tree and records an honest
working-tree-dirty flag; it does not repoint or modify the protected root Git
metadata.
