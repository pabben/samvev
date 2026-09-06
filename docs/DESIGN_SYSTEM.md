# Design system

## Objective

Samvev must look intentional from the first runnable version. It should not become a wall of AI text or generic dashboard cards.

## Shared principles

### Hierarchy before density

Each surface prioritizes one question:

- iPhone: What applies to me, and what can I do?
- Shared display: What does the household need to know now?
- Shelly: What matters at this location in the next moments?

### Information shape

A useful card answers:

- what
- who
- when
- why it appears
- available action
- source or author

Long AI output belongs behind a detail view.

### Semantic tokens

Use tokens such as:

```text
surface.canvas
surface.card
surface.elevated
text.primary
text.secondary
state.information
state.attention
state.urgent
state.success
person.accent
```

Meaning must not rely on color alone.

### Appearance

Every concept supports:

- light
- dark
- automatic/system or scheduled appearance

Light and dark are not separate feature implementations. Components share structure and semantic tokens.

### Accessibility

- readable contrast
- scalable text on personal devices
- large touch targets
- distance-readable typography on shared displays
- reduced-motion support
- screen-reader labels
- no important text baked into images

## Five structural concepts

The concepts differ in information architecture, not only color. See [design/README.md](design/README.md).

1. **Nordic Soft Cards** — modular dashboard cards
2. **Timeline and Person Columns** — day/time and each household member
3. **Playful Family Board** — person and routine first
4. **Premium Focus** — one primary item plus restrained supporting context
5. **Action Board** — new, planned, needs action and completed

## Recommended initial combination

Use **Action Board** as the information model for AI notices and household work, while offering **Timeline and Person Columns** as the morning/shared-display view. The product can share components and tokens without forcing the same layout on every surface.

## Responsive behavior

A component may change presentation by surface:

- one notice card on iPhone
- grouped household lane on the large display
- a single large action on Shelly

The API returns semantics and permissions, not pixel layout.

## Design review checklist

- Is the most important item identifiable in three seconds?
- Can the shared display be understood from normal room distance?
- Does the compact view contain only actions relevant there?
- Is source/author visible without dominating?
- Are private details absent from shared projections?
- Does both light and dark appearance preserve hierarchy?
- Can translated text expand?
- Is an urgent state rare and meaningful?
