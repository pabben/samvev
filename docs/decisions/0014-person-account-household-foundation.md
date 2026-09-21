# ADR 0014: Person, account and household foundation

- Status: Accepted
- Date: 2026-09-09

## Decision

Keep a household Person separate from its optional authenticated Account.
Creation and later editing may attach a password account or a hashed,
single-use invitation while setting the membership role in the same
administrator flow.

Use four role presets: installation owner, household administrator,
adult/member and restricted member/child. Administrator presets have exact
capability sets. Only an installation owner can grant installation ownership,
and the server locks the installation row while ensuring that the last usable
owner cannot be demoted or disabled.

Store an optional calendar `birth_date` on Person and derive age rather than
persisting a static age. An opt-in household setting exposes a minimized next
birthday view to authenticated household members. A 29 February birthday is
observed on 28 February in non-leap years.

New installations default to Norwegian Bokmål. Existing explicit installation,
household, account and display choices are preserved.

Live installation data is staged in a separate household through a two-phase,
local-only bootstrap. Prepare leaves synthetic accounts active. Finalize
requires an accepted owner invitation and a newer owner session before it
disables source accounts without deleting their records.

## Consequences

Full birth dates stay behind `people.manage` and never enter display
projections. Invitation tokens exist in clear text only in the administrator's
browser or ignored mode-0600 bootstrap output. Clear tokens cannot be
reconstructed from their hashes, so operators retain that output or explicitly
rotate the pending invitations.
Administrators can revoke and replace a pending invitation; bootstrap can rotate
all still-pending invitations into a new, non-overwriting private output file.
