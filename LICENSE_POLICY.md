# Samvev licensing policy

This document explains the intended licensing structure. It is not legal advice and does not replace the license texts.

## Code

Unless a file or directory contains a more specific notice, Samvev server, worker, web and display code is licensed under:

**GNU Affero General Public License, version 3 or any later version** (`AGPL-3.0-or-later`).

The full version 3 text is included in [`LICENSE`](LICENSE) and [`LICENSES/AGPL-3.0-or-later.txt`](LICENSES/AGPL-3.0-or-later.txt). Project source files should use an SPDX identifier where practical:

```text
SPDX-License-Identifier: AGPL-3.0-or-later
```

## iOS and WidgetKit code

The planned native iOS application and WidgetKit extension are intended to use **Mozilla Public License 2.0** (`MPL-2.0`) unless a later architectural decision record changes this before public distribution.

That code must live in a clearly identified directory with its own license notice. No iOS source exists at the time this policy is first committed.

## Documentation and original documentation artwork

Documentation under `docs/` and original artwork created specifically for the documentation are intended to use **Creative Commons Attribution-ShareAlike 4.0 International** (`CC-BY-SA-4.0`) unless a file states otherwise.

The legal code is included as [`LICENSES/CC-BY-SA-4.0.html`](LICENSES/CC-BY-SA-4.0.html).

## Third-party material

Third-party dependencies, icons, fonts, screenshots, protocols and copied examples retain their original licenses and attribution requirements. They must not be relicensed merely by placing them in this repository.

Contributors must record third-party origins and licenses before adding such material.

## Name, logo and service identity

The software licenses do not automatically grant permission to imply that a modified build or hosting service is the official Samvev project or official Samvev hosting service. See [`TRADEMARKS.md`](TRADEMARKS.md).

No statement in this repository claims that Samvev is a registered trademark.
