# R15 display contract: issues 17 and 18

Status: backend implemented and locally tested; UI, integrated QA and public restore/publication pending. Exact API handoff: [ROUND_15_DISPLAY_API.md](ROUND_15_DISPLAY_API.md). Additive 043/044 follow existing 042. The coordinator serializes writers. B owns backend/contracts/migrations; C owns UI after B delivers. Existing IDs, assignments, grants and rights remain intact unless an authorized manager explicitly changes them.

## Reconnect (043)

- Add `displays.credential_generation integer NOT NULL DEFAULT 1` and nullable `pairing_requests.expected_credential_generation`. Backfill approved pending requests from their existing referenced display generation.
- Keep verifier-bound five-minute pairing start/redeem. Add manager `POST /households/:hid/displays/:did/pairing/approve` with strict `{code,expectedCredentialGeneration}` only. Session, CSRF and same-household display.manage authority rechecked after lock waits. Non-revoked registrations can reconnect even when credential expired.
- Approval captures generation, does not rotate yet. Redeem atomically consumes pairing, validates expected generation, rotates credential/expiry and increments generation, preserving display ID and every configuration/grant. Consistent pairing-then-display locking; concurrent approvals cannot both redeem on old generation. Existing create-new approval remains separate.
- New `POST /display/disconnect` accepts strict empty body and no display ID. Revoke only the matching presented credential and clear its exact display cookie; stale cookies cannot revoke a replacement. Preserve administrator sessions and display registration/grants. Client clears projections/caches/queued actions/media/ack state and closes its SSE before switching.
- Credential changes notify SSE invalidation; immediately revalidate affected stream credentials, emit authorization-revoked and close. Retain periodic checks. Final credential/generation checks fence projections/activities across rotation; existing mutation/media fences stay. Ignore late responses/SSE/pair polls after source generation changes; propagate local known revocation across tabs.
- Offline caches cannot be remotely erased instantaneously; enforce existing finite deadlines and never restore a cache after known revocation.

## Presentation policy (044)

- `displays.birthday_mode`: `off|all|legacy_selected`. New displays off. Existing any birthday grants →legacy_selected, otherwise off. Even old all-current-person grants are not consent for future people. Preserve old grant rows and selections in migration.
- PATCH permits explicit `birthdayMode: off|all`; unrelated updates preserve mode. Reject conflicting mode/per-person payloads and silent legacy reactivation after explicit all/off.
- legacy_selected reproduces old household setting/family layout/selected IDs/per-person rules. off yields no birthdays anywhere. all queries all current/future household birthdays dynamically, independent of person/profile selections and old birthday grants. Explicit all is independent of the Home birthday preference; privacy/expiry/revocation still suppress it.
- Dedicated authorized birthday projection: mode, localDate and due today/tomorrow entries `{personId,displayName,due}`. No DOB/year/age/photo. Compatibility familyLayout alias may remain. Today/Tomorrow standalone cards must receive allowed birthdays without requiring family_layout. Birthday names outside profile roster render as birthday-only text, not an unauthorized profile/details/photo grant.
- Nullable `displays.person_ids_override uuid[]`: NULL inherits setup person IDs, [] selects none, list selects current same-household IDs. PATCH `personIdsOverride: null|string[]` validates uniqueness/bounds/household. Effective selection is override ?? setup selection, then content-specific ACL intersection. Device selection never edits shared setup or grants profile/calendar access.
- Administrative DTOs distinguish raw overrides, setup defaults and effective locale/theme/person choices. Preview and runtime apply identical precedence.

## User interface and coarse status

Per-device content selector and setup selector have separate select-all/clear/individual controls, counts and follow-setup where relevant. Select all stores current listed IDs; only birthday all includes future people automatically. Language/appearance is one initially collapsed summary with inherit options inside menus.

Legacy birthdays need an explicitly limited/indeterminate state; no person-wise list or silent conversion to all/off. A manager deliberately selects new all/off semantics.

Display settings identify device and setup. Server-derived content readiness distinguishes privacy, none selected, not shared, external disabled, and ready; zero current events is not proof of missing grants. Do not disclose unshared source names. Connection/SSE status indicates transport only. Reconnect/new-device controls are distinct. Previously authorized browser can request a replacement code without cookie developer tools.

## Tests and recovery

Two-browser reconnect preserves ID/assignment/overrides/grants, rejects old cookie on API/SSE and in-flight reads, and prevents stale disconnect affecting replacement. Test timeout/verifier/cross-household/stale generation/revoked registration and late client callbacks. Test old mixed birthday migration, unselected/new people in all, off on every surface, privacy/revocation, no profile/calendar/action grants, inheritance and per-device/shared setup independence.

After these policies are enabled, R14 runtime fallback is unsafe because it ignores overrides and birthday off. Backend faults use forward repair retaining data; UI-only fallback needs an explicitly API-compatible R15 checkpoint. Old backups are never restored over subsequent writes. Update and review ops gates for 041→042→043→044 before publication. Physical target-device verification remains an owner test; synthetic two-browser proof is separate.
