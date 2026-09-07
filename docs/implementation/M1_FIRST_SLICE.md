# M1 first runnable slice checklist

This retains the kickoff's first-slice checklist and execution requirements.
Check an item only when execution evidence is linked from M1_STATUS.md.

Final local acceptance and independent replay passed on 2026-09-07. All checked
items are supported by M1_QA.md, M1_DELIVERY.md and coordinator artifacts. The
combined release-gate item remains unchecked because the final independent
[release review](M1_RELEASE_GATE.md) is BLOCKED solely by Git delivery.
Implementation findings and the complete QA retest are resolved; local
acceptance is PASS.

## User acceptance

- [x] One documented command starts the samvev-m1 stack.
- [x] First-run wizard claims owner once and creates first household.
- [x] Setup survives interruption and can resume.
- [x] en/nb, household timezone and light/dark/system selection work.
- [x] At least three household people; administrator, adult, two limited people
      in acceptance fixture, optional login and explicit capabilities.
- [x] A permitted limited member can sign in and create messages.
- [x] Display presents expiring code; administrator pairs restricted display.
- [x] Display credential is independently revocable; household/admin APIs denied.
- [x] Composer chooses household/people/display audience, previews and publishes now.
- [x] A message appears live without refresh and records device display separately.
- [x] Limited author schedules tomorrow 07:00 gym-clothes message with expiry.
- [x] Accelerated/test-time demonstration avoids waiting until tomorrow.
- [x] Scheduled publication is automatic, idempotent and restart-safe.
- [x] Author edits and withdraws scheduled message before publication.
- [x] Published withdrawal and expiry remove cards automatically.
- [x] Scheduled/published/displayed/cancelled/withdrawn/expired/failed states are honest.
- [x] Cross-household read, mutate and audience-targeting attempts fail server-side.
- [x] Offline display retains only safe projection and visibly marks stale state.
- [x] Offline known expiry/cache deadline and reconnect/revocation clearing work.
- [x] Synthetic demo mode works and is clearly labeled.

## Design and localization

- [x] Nordic Soft Cards tokens, Action Board model and optional morning layout.
- [x] Shared display has distance-readable hierarchy and safe content only.
- [x] Workbench: message/person/status/schedule/header/empty/offline components.
- [x] Externalized en/nb strings, localized times and accessible labels.
- [x] Light, dark and system preference work.
- [x] Keyboard/focus, reduced motion, accessible primary screens.
- [x] Loading/error/empty/offline/long-text/expanded-translation states.
- [x] Visual checks: phone, 16:9 shared and Shelly XL 1280×752.
- [x] Stable visual snapshots: three sizes × two themes × two locales.

## Tests, operations and delivery

- [x] Unit lifecycle and permission tests executed.
- [x] PostgreSQL integration/migration/isolation/scheduling/expiry tests executed.
- [x] Browser onboarding/member/pairing/live/schedule/edit/withdraw tests executed.
- [x] Clean empty-database/volume install executed.
- [x] Actual worker restart across due time executed.
- [x] Accessibility, localization and visual regression checks executed.
- [x] Secret scan and available dependency/security checks executed.
- [x] All required tests pass without weakening, skipping or disabling.
- [ ] Gate D findings resolved; QA complete retest executed; release gate PASS.
- [x] Coordinator independently verifies critical evidence.
- [x] README, environment example, demo/install/troubleshooting current.
- [x] Screenshots and migration/rollback notes provided.
- [x] No secret/private family data introduced; no sibling/host-global changes.
- [x] samvev-m1 stack remains running and healthy.
- [ ] Signed-off Conventional Commits pushed to requested work branch.
- [ ] Draft PR against main exists; no merge/tag/release/production deployment.
