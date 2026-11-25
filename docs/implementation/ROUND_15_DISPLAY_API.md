# Issues 17/18 backend handoff

Backend candidate only; coordinator integrates source and authorizes the next writer. No real device was reconnected. Migration 043/044 were applied only to isolated test-db. Public runtime remains R14.

## Pairing lifecycle

Physical browser keeps the current flow: POST `/api/v1/display/pairing/start` with `{verifierHash}` -> `{pairingId,code,expiresAt}` (five minutes). Poll `/api/v1/display/pairing/:pairingId/status`, then POST `/api/v1/display/pairing/redeem` with `{pairingId,verifier}`. Physical browser supplies no target display ID. Redeem sets the HttpOnly display cookie at `/api/v1/display`.

Create-new manager approval remains POST `/api/v1/households/:householdId/displays/pairing/approve` with its existing schema. Reconnect uses POST `/api/v1/households/:householdId/displays/:displayId/pairing/approve` with **only** `{code,expectedCredentialGeneration}`. Requires manager session, same-household display.manage, CSRF and same origin. Success 200 returns `{displayId,credentialGeneration}`. Approval preserves old access. Only successful redeem rotates credential/expiry and increments generation. Redeem keeps its existing snake_case result; server credential generation is not exposed to the physical browser. It is available only in manager DTOs and manager approval.

Generation conflict: 409 REVISION_CONFLICT with `details.credentialGeneration`. Revoked/foreign registration: 404. Invalid approval code: 404 PAIRING_INVALID. Invalid/expired/stale-generation redemption: 410 PAIRING_EXPIRED. A credential-expired non-revoked registration can reconnect.

POST `/api/v1/display/disconnect` with strict `{}` and same origin. No display ID. Returns 204 and clears only the display cookie. Matching credential is invalidated; stale cookies cannot invalidate a replacement. Administrator sessions, registration ID, assignment, selections and grants remain.

SSE retains `ready`, `heartbeat`, `projection-invalidated`, `listener-degraded`, `listener-restored`; credential rotation/disconnect/revocation sends **`authorization-revoked`** and closes the old stream after notification revalidation. Periodic revalidation remains fallback. Display GET/HEAD responses are credential/generation fenced immediately before sending; existing mutation/service authorization gates and bounded dispatch receipts remain unchanged. Stale access returns 401. Concurrent presentation-policy changes can return 409; refetch current policy.

Client must close SSE and clear its projections, media, action/ack queues and caches before switching source. Ignore late requests, stream events and pair polls using a local source generation. Broadcast known revocation to other tabs. Never restore cached content after known revocation; remote offline erasure is not instantaneous.

## Manager device DTO and PATCH

GET `/api/v1/households/:householdId/displays` still returns `{displays:[...]}`. Existing snake_case base fields remain. Only display.manage receives these extra fields (also returned by successful device PATCH):

- `credentialGeneration: number`
- `birthdayMode: 'off'|'all'|'legacy_selected'`
- `personIdsOverride: string[]|null`
- `localeOverride: 'en'|'nb'|null`, `themeOverride: 'light'|'dark'|'system'|null`
- `setupName: string`
- `setupDefaults: {locale,theme,personIds}`
- `effective: {locale,theme,personIds}`
- `contentReadiness: {calendar: 'privacy'|'none_selected'|'external_disabled'|'not_shared'|'ready'}`

PATCH `/api/v1/households/:householdId/displays/:displayId` adds `birthdayMode: 'off'|'all'` and `personIdsOverride: null|string[]`. Null inherits the shared setup; [] selects no people; arrays select the current listed IDs. IDs must be unique, <=100 and in this household. Effective people are override ?? setup selection, intersected with current household people and the existing content ACLs. It never edits the shared setup or grants new profile/calendar permissions.

Explicit birthday all/off preserves old grant rows but supersedes them. Legacy arrays are accepted only while mode remains legacy_selected. Combining birthdayMode with birthdayPersonIds is rejected; arrays cannot silently reactivate legacy after all/off. Display new registrations default off. Migration classifies any existing birthday grant, even every current person, as legacy_selected. UI must show legacy as limited/indeterminate and require a deliberate all/off choice.

Keep the existing effective locale/theme snake_case fields for compatibility; use `*Override`, `setupDefaults` and `effective` to explain inheritance. New raw policy fields are not available to ordinary household.view callers.

## Runtime and preview projection

`display` now includes `setupName` alongside existing `id`, `name` and `setupId` identity. Both runtime and manager preview expose:

```ts
birthdays: {
  mode: 'off'|'all'|'legacy_selected';
  localDate: string;
  entries: Array<{personId:string;displayName:string;due:'today'|'tomorrow'}>;
}
contentReadiness: {calendar:'privacy'|'none_selected'|'external_disabled'|'not_shared'|'ready'}
```

Birthday all includes current and later household registrations, regardless of person selections, profile grants or the Home birthday preference. It works with standalone Today/Tomorrow cards without family_layout. Off emits no birthday entries. Privacy and credential revocation/expiry still gate access. Entries contain no DOB, year, age or photo. Render birthday-only names without adding a profile/detail/photo grant or requiring membership in the profile roster. `familyLayout.upcomingBirthdays` remains a compatibility alias to the allowed due entries; new rendering should consume `birthdays` directly.

legacy_selected preserves old Home setting/family-layout/selected-person/per-person restrictions. Preview applies the same device-over-setup override precedence as runtime. `setup.personIds` is the effective runtime/preview selection; raw/default/effective details are only in the manager DTO.

Calendar readiness is derived from configuration and both current connection-level and exact selected source-level display grants, not event count. Privacy wins, then external disabled/card absent. An enabled, connected, selected shared household source is ready even with no selected people; shared person-scoped sources also need an applicable selected subject. `none_selected` is informative only when a shared person-scoped source exists and the effective person selection is empty. Missing source-level sharing is `not_shared`, including when another calendar on that connection is shared. Empty-but-shared applicable calendars are ready. It contains no hidden source names. SSE transport health is independent of content readiness.

## Recovery boundary

After 044 policies are used, R14 runtime fallback is unsafe: it ignores birthday off and person overrides. Backend recovery must retain data and use forward repair. A UI-only fallback needs an explicitly verified API-compatible R15 checkpoint. Do not restore an old database over newer writes. Coordinator/ops owns publication and restore gates.

## Prior frozen validation (before readiness review)

`backend-source.sha256` records the API/contracts source for the green full run below. The focused readiness correction described next is a later source change; the full 388-test result is prior evidence, not a claim of a complete rerun after that correction.

- Full API: **388/388 PASS**, no failures/skips, exit 0 (`backend-full-api-final.log`). Command: `docker compose -p samvev-m1 --profile test run --rm --no-deps test npm test --workspace @samvev/api`.
- Final focused regression: **17/17 PASS**, exit 0 (`backend-final-targeted.log`): new policy integration, api.integration, round13-display-backend integration and round13-home-assistant-control integration.
- API/contracts typechecks and contracts **7/7 PASS**, exit 0 (`backend-check.log`). Command: `docker compose -p samvev-m1 --profile tools run --rm --no-deps tools sh -c 'npm run check --workspace @samvev/api && npm run check --workspace @samvev/contracts && npm test --workspace @samvev/contracts'`.
- The first full API log is retained as historical failed evidence (387/388); the generic read fence was corrected to GET/HEAD and the complete rerun above passed, preserving the existing bounded HA unknown receipt assertion.

All logs/handoff/hash manifest are mode 600. No frontend/locales, Git, production runtime, real device, real household data, model or physical HA calls were changed by this backend task. Synthetic browser cookies/SSE are tested; actual physical device verification remains separate. Coordinator/ops still owns backup/restore, deployment and the post-044 recovery boundary.

## Focused readiness review correction

Only `app.ts`'s readiness helper and its policy regression fixtures/tests changed after the 388-test green checkpoint. Readiness now intersects the exact selected source's same-household `calendar_source_display_targets` with the connection display grant, enabled source, connected calendar and household/selected-person applicability. Sharing calendar A on one connection cannot make selected private B ready. No projection ACL, source selection, permission grant, migration or public field shape changed.

A shared household source is ready with `personIdsOverride: []`; tests also prove the unchanged activity projection can show a permitted household event in that state. `none_selected` is only informational for a shared person-scoped source and empty effective person selection. Missing selected source sharing is `not_shared`. No hidden source name is returned in readiness, device DTOs or the display catalog.

Final focused policy regression: **8/8 PASS**, no skips, exit 0 (`backend-readiness-tests.log`). Command: `docker compose -p samvev-m1 --profile test run --rm --no-deps test node --import tsx --test --test-concurrency=1 services/api/src/round15-display-policy.integration.test.ts`.

Final API typecheck: **PASS**, exit 0 (`backend-readiness-check.log`). Command: `docker compose -p samvev-m1 --profile tools run --rm --no-deps tools npm run check --workspace @samvev/api`.

`backend-readiness-source.sha256` records this later source; the earlier manifest and full 388-test log remain historical passing evidence. A new complete API run after this focused change was explicitly deferred by the coordinator to final integration/review. Backend is FROZEN again.
