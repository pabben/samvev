# Internationalization

Internationalization is a foundation requirement, even though the first translations are English and Norwegian Bokmål.

## Locale model

- installation default locale
- household default locale and time zone
- user locale
- display locale
- AI output locale per recipient/destination

Language and time zone are separate settings.

## Translation rules

- No user-facing strings are hard-coded in components.
- Use stable semantic keys such as `tasks.claim` rather than English text as a key.
- Support plural forms and variable ordering.
- Format dates, time, numbers, units and lists with locale-aware libraries.
- Preserve user-authored content in its original language.
- Optional translation shows both original and translated content when meaning matters.
- Avoid string concatenation that prevents translators from changing word order.
- Icons cannot be the only label for important actions.

## Initial locales

- `en`: English reference locale for developer-facing strings
- `nb`: Norwegian Bokmål

A missing translation falls back predictably and is detectable in CI or development mode.

## Design implications

- Buttons and cards must allow text expansion.
- Do not bake text into images.
- Shared-display typography must remain readable with longer translations.
- Right-to-left layout is not required for the first release, but component structure should not make it impossible.

## AI output

The requested language is part of the structured AI job. The original source excerpt and source URL remain available. AI translation must be labelled as generated when it could affect interpretation.
