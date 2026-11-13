# Display targets

Samvev uses one data model but different layouts for each context.

## Shared family display

Typical devices:

- iPad or Android tablet in kiosk/full-screen mode
- browser on a Samsung Family Hub where model/firmware permits
- dedicated large touch display
- TV or monitor with a small browser client

Primary questions:

- What matters now?
- What happens next?
- What must someone remember or do?
- Is there a message for the household?

The default view avoids private meeting details, long AI prose and dense administration.

## Shelly Wall Display XL

The Shelly view is a compact satellite, not a miniature copy of every dashboard feature. Intended content:

- next departure or event
- a few things to remember
- location-relevant household tasks
- safe allowlisted actions
- concise home status

The Shelly Wall Display XL has no general web browser: its firmware only offers a Home Assistant page that opens a Home Assistant dashboard URL. Samvev therefore reaches Shelly through Home Assistant, in two steps:

- **A – Samvev inside a Home Assistant dashboard (now).** A Home Assistant dashboard view contains a Webpage (iframe) card that shows `https://<samvev-origin>/display`. The display pairs and stays signed in like any other paired display. See [Showing the display inside Home Assistant](#showing-the-display-inside-home-assistant).
- **B – Samvev content as native Home Assistant entities and cards (later).** Samvev publishes the compact satellite content above to Home Assistant, which renders it with its own cards. This avoids the frame and cross-site cookie dependencies of A.

Unofficial workarounds such as developer mode with a side-loaded browser are not a supported path.

The exact rendering behavior, session persistence across restarts and interaction limits of path A must still be verified on real hardware and current firmware before it is declared complete (issue #12).

### Showing the display inside Home Assistant

By default no other site may frame Samvev. To allow Home Assistant to frame only the paired display page, set the exact Home Assistant origin(s) the wall panel uses in the runtime `.env` and restart the app:

```dotenv
# Space or comma separated exact origins; no paths or wildcards.
SAMVEV_DISPLAY_FRAME_ANCESTORS=http://<home-assistant-lan-ip>:8123 https://<home-assistant-hostname>
```

Effects when set (requires an `https` `SAMVEV_PUBLIC_ORIGIN`):

- Only the `/display` document gets `frame-ancestors 'self'` plus the listed origins, and no `X-Frame-Options`. Sign-in, administration and every other page stay unframeable.
- Newly paired displays receive the display cookie as `Secure; HttpOnly; SameSite=None; Partitioned`, scoped to `/api/v1/display`. Member session cookies stay `SameSite=Strict`.
- All unsafe requests are still rejected unless their `Origin` is the Samvev origin, so allowing a frame does not allow other sites to act on behalf of a display.
- Displays paired before the change keep their old `SameSite=Strict` cookie. Pair the wall panel again from inside the Home Assistant frame after enabling the setting.

Home Assistant setup: add a dashboard view in panel mode with a Webpage card whose URL is `https://<samvev-origin>/display`, then point the Shelly Home Assistant page at that dashboard. On the panel, the card shows a pairing code; approve it under Displays in Samvev.

Known limits:

- When Home Assistant is opened by IP address it is a different site from Samvev, so the display cookie is a third-party cookie. Some embedded browsers block those, and the panel then shows the pairing code again after every reload. If that happens on the Shelly, use a Home Assistant hostname under the same registrable domain as Samvev (same site), or wait for path B.
- A reverse proxy in front of Samvev must not add its own `X-Frame-Options` or `frame-ancestors` header, or it overrides this setting.

## Samsung Family Hub

Two possible paths require model-specific validation:

- display a curated calendar through a supported connected calendar
- open the Samvev shared-display web view in the available browser

Samvev must not assume that every Family Hub generation can pin or keep a custom web page always visible.

## Google Nest Hub

Useful roles may include:

- text-to-speech morning/evening briefing
- temporary cast of a concise status view
- voice entry through supported automation paths

It should not be the only permanent interactive display because casting and media use can replace the view.

## Pairing and security

Every display has:

- its own revocable credential
- household and display-group assignment
- locale and theme
- allowed content classes
- allowed actions
- last-seen and software information

Displays receive only their authorized projection.

## Offline behavior

A display may cache current safe content. It must show when data is stale and avoid executing actions while authorization state cannot be confirmed.
