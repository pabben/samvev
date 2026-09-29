# M3 design review mailbox

Run a new local review round from the repository root:

```bash
bash scripts/design-review.sh
```

The command only uses the running, isolated `samvev-m1` `qa-db`, `qa-worker`,
`qa-app`, and a one-shot `qa-browser`. It captures the real synthetic member
Home at `http://qa-app:4173`; it does not start services, add fixtures, change
product content, use a remote origin, commit, push, create a PR, or trigger
GitHub Actions. It checks demo mode, synthetic login, populated Home people and
items, the expected Family Hub UI, themes, page errors, and outbound browser
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
and Today/Tomorrow can change across midnight. An empty fixture set causes the
command to fail rather than invent content. Full-page mobile screenshots retain
the actual fixed navigation bar at the original viewport boundary, which can
cover a small strip. Work should use the viewport images together with the
full-page supplements. No application migration is needed; revert the tooling
commit to remove this routine, preserving the QA database.

Check the publication safeguards locally with:

```bash
node --test scripts/design-review-publication.test.mjs
```

After reviewing a new round, stage the validated review files, commit with DCO
sign-off, and explicitly push only the feature branch:

```bash
git add docs/design/review scripts/design-review.sh scripts/design-review.mjs scripts/design-review-publication.mjs scripts/design-review-publication.test.mjs
git commit -s -m "docs(design): add M3 review round"
git push origin feat/m3-family-hub
```

Those are manual operator steps; this command does not commit, push, open a PR,
or trigger Actions.
