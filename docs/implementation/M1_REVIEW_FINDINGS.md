# M1 Gate D findings and Gate E resolution log

Reviewed 2026-09-07. All three reviews and their rechecks completed. All
confirmed implementation findings below are resolved and the final complete
QA retest passed. Local UX is accepted; overall release review/Git delivery
remain pending. See M1_DELIVERY.md and M1_QA.md for final execution evidence.

The chronological checkpoint paragraphs below describe earlier states. The security
agent's initial final response was tool-blocked; its subsequent remediation-only
handoff completed successfully. Probe results are attributed to that agent.

## Infrastructure and test dependencies — devops_engineer

| ID | Finding | Required evidence | Status |
|---|---|---|---|
| D1 / SEC-08 | Node 24.14.0 and PostgreSQL 17.6 predate security fixes | Current same-major images, preserved runtime data, migrations and full retest | Verified; final eighteen tests, preserved data and complete QA pass |
| D2 / SEC-08 | Full npm audit finds two high Playwright entries | Safe pinned Playwright, rebuilt browser, full audit clean | Fixed; audit zero, Chromium launch passes |
| D3 / SEC-09 | QA cleanup deletes by name and suppresses errors | Exact project-label guard, fail on deletion failure, verified fresh QA volume | Verified; exact-label volume recreation executed in complete QA |

Primary version/security sources checked by coordinator:
[Node security release](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases),
[Node 24.20.0](https://nodejs.org/en/blog/release/v24.20.0),
[PostgreSQL 17 security](https://www.postgresql.org/support/security/17/),
[PostgreSQL 17.11](https://www.postgresql.org/docs/17/release-17-11.html).
The full npm audit identifies GHSA-7mvr-c777-76hp for the old Playwright pin.

## API and domain — backend_engineer

| ID | Finding | Required evidence | Status |
|---|---|---|---|
| B1 / SEC-01 | Body-only edits resurrect removed display targets | Preserve inactive targets; remove target then edit body/importance remains private | Verified — complete QA passed |
| B2 / SEC-02 | Ten SSE streams exhaust the shared ten-connection pool | Shared dedicated listener, bounded streams, cleanup/revocation; health and normal requests remain responsive | Verified — complete QA passed |
| B3 / SEC-03 | No-login administrators defeat final-owner protection | Elevated authority requires an active login; count only usable administrators; self-demotion regression | Verified — complete QA passed |
| B4 / SEC-04 | People management permits login creation and email disclosure without account management | Gate login creation/email by account.manage; all capability combinations tested | Verified — complete QA passed |
| B5 / SEC-05 | Render ACK takes a foreign message lock before scope validation | One authorized target/household/revision/state lock; cross-household concurrency test and bounded ACK rate | Verified — complete QA passed |
| B6 / SEC-06 | Missing-account login skips password work; limit only per IP/email pair | Equivalent verification work, aggregate IP limit, expired bucket cleanup, generic errors | Verified — complete QA passed |
| B7 / SEC-07 | Other-user edit/withdraw history is not visible; withdrawal lacks audit event | Narrow action/editor name/time on visible messages, original author retained; audit edit/withdraw and isolation tests | Verified — complete QA passed |
| B8 | Restricted projection omits household timezone | Scoped household timezone in API, Oslo rendering assertion | Verified — complete QA passed |
| B9 | Lexical importance order puts normal before attention | Explicit priority order and API test | Verified — complete QA passed |
| B10 | Earliest card expiry invalidates the entire projection | Hard projection TTL at most 15 minutes, independent per-card expiry, reload/revoke bounds retained | Verified — complete QA passed |

Security executed isolated probes confirming target resurrection, shared-pool
starvation, no-login administrator lockout, and account-capability failures.
It removed its synthetic probe records and verified zero remaining probe rows.
Coordinator source inspection independently confirmed the target requeue,
unscoped ACK lock and no-login guard defects before review.

Backend resolution checkpoint: B1–B10 are implemented and the backend writer's
11-test suite passes with zero failures/skips. Table rows remain pending final
integration acceptance until the coordinator replay and complete browser QA.
The SSE regression also terminates only the isolated test database's dedicated
listener, proves truthful new/existing stream degradation and reconnection, and
keeps ordinary API requests responsive. Transient database revalidation errors
no longer falsely revoke displays. See M1_API.md for ready/heartbeat and
degraded/restored payloads; frontend handling and user-visible history remain
part of F3/F6. Runtime migration 004 and health checks passed with retained data.

## Member and display UI — frontend_engineer

| ID | Finding | Required evidence | Status |
|---|---|---|---|
| F1 | Preference controls lack save feedback and allow dropped rapid changes | Localized Saving/Saved/errors; disable or serialize/merge changes; delayed/error/rapid/reload tests | Verified — complete QA passed |
| F2 | Three serious light-theme contrast nodes | Correct semantic colors/footer, unchanged Axe WCAG AA checks pass | Verified — complete QA passed |
| F3 | Lost projection can show fallback identity and Live/All clear | Independent card expiry; true projection loss shows stale/reconnecting and saved-content-cleared text | Verified — complete QA passed |
| F4 | Publish now/Schedule selection is CSS-only | Radio or aria-pressed semantics plus keyboard/selected-state assertion | Verified — complete QA passed |
| F5 | Preview shows raw ISO publication and no expiry | Localized publication, expiry and household timezone, safe invalid-input handling | Verified — complete QA passed |
| F6 | Other-user changes are not visible to affected author | Render safe scoped activity from B7; original author remains unchanged | Verified — complete QA passed |
| F7 | Person UI must reflect account-management boundary | Hide/disable login and email controls appropriately; elevated roles require login; truthful account states | Verified — complete QA passed |
| F8 | Hidden revoked display grants are resubmitted when editing people | Sanitize inactive initial grants; save active visible permissions; retain genuine concurrent-revocation errors | Implemented — real original-profile save and concurrent-revocation checks pass; final QA passed |
| F9 | Keyboard focus escapes a dialog after its last control | Wrap Tab/Shift+Tab; preserve Escape and restore opener focus | Implemented — real browser containment/restoration checks pass; final QA passed |

The immediate-reload preference failure does not alone prove a lost server
write: the current setter waits for PATCH before applying preferences, while
the test reloads immediately. UX separately confirmed enabled controls can send
stale full preference objects or have changes dropped while useAction is busy.
The fix and test must use observable save completion, not arbitrary sleeps.

Frontend resolution checkpoint: F1–F7 are implemented; eight units, ten focused
browser checks and fifteen full smoke checks pass. Axe rules remain unchanged.
The smoke discovered an offline recovery stall, which was fixed by opening a
fresh SSE stream and requiring ready plus a new projection; both browser suites
were rerun. The twelve populated candidates have explicit readiness assertions.
They are not approved baselines. The backend `has_active_login` addition is now
implemented and covered by active/disabled/profile-only and capability-visibility
API regressions; all fifteen current tests pass. See
`artifacts/frontend-candidates/README.md` for the preceding frontend evidence.

## Visual and complete acceptance evidence — qa_engineer

- The 53.61% mismatch is a state mismatch: mobile/en/light baseline is empty
  with fallback identity while the actual capture contains Kitchen and two cards.
  UX personally inspected 16 images. Other sampled baseline profiles were
  populated and structurally matched. No baseline replacement is approved yet.
- Every populated capture must assert identity, exact fixture card count/content
  and order, resolved timezone, theme/locale and connection readiness. Capture
  empty states separately. Use deterministic time or narrowly masked timestamps,
  with separate time-format assertions, instead of a global 1% pixel allowance.
- Review candidate images after fixes, then create approved baselines explicitly
  and execute the normal comparison without update mode.
- Expand focused evidence for system appearance/OS changes, long/unbroken text,
  expanded nb, retained form values on errors, below-fold controls, keyboard and
  modal focus behavior, Timeline/Person Columns and workbench, fresh empty/privacy,
  offline card expiry, true cache deadline, revoked pairing and polling fallback.
- Run the complete qa-test sequence after all fixes, including exact persisted
  restart transitions: missed window scheduled → expired; valid recovery
  scheduled → published → expired. No skips, weakened assertions or disabled rules.
- Repeat unit/integration/migration tests, typecheck/build, full audit and secret
  scan after changes; retain superseded failures with clear attribution.

## Coordination and external delivery

Gate E writers run strictly sequentially: devops, backend, frontend, then QA.
The coordinator integrates docs and independently verifies critical evidence.
The release gate runs last; further findings return to one responsible writer
at a time followed by complete retest.

Read-only Git metadata remains an actual external blocker for signed-off
commits, push and draft PR. It does not excuse unresolved implementation/test
failures. No permission bypass, real private data or prohibited integrations
are part of these fixes.

## Gate E read-only recheck and candidate QA checkpoint

All three read-only rechecks returned. Security found SEC-01–SEC-09 source
resolved, with final execution of the corrected volume helper still required.
Requirements found the reviewed product fixes complete and identified tracking
document corrections. UX accepted the reviewed visual direction and F1–F6,
while identifying F7's remaining “Can sign in” label for disabled accounts.
The next frontend turn will correct that label and complete the remaining
keyboard, long-text, Timeline/workbench and difficult-state evidence.

QA's candidate slot passed sixteen unit/integration tests (web eight, core
three, API five, including checksum rejection), sixteen isolated smoke checks,
and twelve candidate profiles. DOM Range masks cover only dynamic timestamp
text; localized expected/actual time strings are recorded separately. Default
comparison failed closed without approved baselines as intended. No baseline
has been approved or created by this Gate E workflow.

A runtime browser replay then exposed F8. Coordinator source inspection and a
scoped read-only database query confirmed Robin had three revoked grants and
one active grant: the editor hid the former but submitted their IDs. Backend
rejection is correct. The failure is retained and routed to frontend; test
fixtures must not be changed to conceal it. Final acceptance remains pending.

Final frontend checkpoint: F7–F9 fixes passed ten web units, workspace check,
build and ten full UX browser checks with seventeen captures. The original
Robin profile's historical grants were exercised; a fresh own revoked-grant
fixture makes the check repeatable in isolated QA. Added UI coverage includes
tab focus, modal containment/restoration, mobile controls and retained drafts
after HTTP 503, long unbroken nb text, two-author Person Columns, real empty,
privacy and revoked display states, loading/retry and three workbench sizes.
The exact runtime browser command stopped on a real pairing rate limit and is
still mandatory in final QA after its normal window reopens.

UX approved the exact isolated qa-candidates manifest at 02:46:05.751Z
(SHA-256 255eef840bfe78431a62a5791f788aad8a1e1cd43e1c8b9e6648b66e098ca71f).
This is baseline-source approval only. Current frontend-candidates files were
overwritten by QA's 02:49 distinct-person wiring control and are superseded
control evidence; they must not be promoted or treated as fixed-fixture PASS.

## Final resolution

D1–D3, B1–B10 and F1–F9 are verified by complete QA and the coordinator
replay. Fresh QA passed 17 smoke, 10 focused and 10 UX checks; runtime passed
16 smoke and 10 focused checks; eighteen unit/integration tests pass. The
actual restart ledger and all twelve visual comparisons pass. Approved image
hashes are unchanged; exactly four reviewed clock masks gained one pixel. A
separate fixed-calendar screenshot context and the approved one-page capture
sequence make captures repeatable while live/lifecycle tests remain real.

The earlier pairing-rate failure, clock-edge and card-border capture failures
are superseded by the final uninterrupted passing sequence. Source images and
comparison limits were not automatically replaced or weakened. No remaining
confirmed high/medium product or security finding is open. Signed-off commits,
push and draft PR remain blocked by the read-only Git filesystem.
