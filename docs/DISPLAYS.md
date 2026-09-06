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

The exact rendering path, browser/kiosk behavior, session persistence and interaction limits must be verified on real hardware and current firmware before implementation is declared complete.

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
