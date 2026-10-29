# Round 15 owner actions

These actions remain outside the local synthetic verification:

- Provide rights evidence for Google, Microsoft, Spond, and Home Assistant marks before any actual logo assets are reintroduced. Logo assets were removed from the delivery; current UI uses generic code-native glyphs and visible names.
- Complete Google OAuth consent and Microsoft app registration in the authorized owner account.
- Restore/validate the expired-TLS Home Assistant endpoint before confirming HA connectivity; do not bypass certificate validation.
- Validate the private ICS source in the owner's session and confirm its sharing scope.
- Review school task A's observed final JSON/schema validation failure from owner-visible evidence. The raw output is unavailable, so the exact cause is unverified. Task B's earlier generic failure remains undiagnosed. Enable school display metadata only as a separate explicit owner choice. No live repair or new model run is claimed.
- Perform physical iPad, Shelly Wall Display XL, and actual shared-screen checks.

The public test runs the partial R15 deployment: source `05cf86dc83ab70070b7050b2c25fa71cff6380bb`, image `sha256:20a587bbc1f8630afdbb02be881ef97f996ae8ee58eaa14c1c7112afdaf61e10`, schema 45. The public smoke reached the People route, but did not exercise the color editor: `peopleColorControl=not-authorized` because the synthetic account lacks `people.manage`. Do not claim public color editing acceptance.
