# Codex implementation kickoff — first runnable Samvev slice

Use this prompt from the root of a dedicated Samvev working directory. Replace only values explicitly marked as local placeholders.

## Mission

Build the first end-to-end, locally testable Samvev milestone with production-minded foundations and polished visuals. Work autonomously until the acceptance scenario is runnable, tested and documented. Do not attempt the entire roadmap.

The first slice is **multi-user scheduled household messages plus a paired shared display**. It must prove that Samvev is a general coordination platform and establish the design system that later AI notices will reuse. Do not begin external AI monitoring, iOS, Homey device control, Home Assistant, calendars or rewards until this slice is complete.

## Repository and host safety

1. Confirm `pwd` and treat the current directory as the only writable project root.
2. This Ubuntu VM hosts unrelated projects. Do not inspect, edit, restart, stop, prune or reconfigure sibling projects, global reverse proxies, databases, Docker networks, system services or firewall rules.
3. Do not run `docker system prune`, destructive cleanup, broad `find /`, or commands outside the project root except read-only environment checks.
4. Do not use `sudo` unless installation is unavoidable; report the exact need instead of changing the host silently.
5. Use Docker Compose project name `samvev` and project-local volumes/networks. Detect port conflicts and choose unoccupied development ports documented in `.env.example`; do not bind 80/443.
6. Never add credentials, tokens, personal names, real school data or household information to Git. Use anonymized fixtures.
7. Work on a branch named `feat/m1-first-runnable-slice`. Do not force-push, merge to `main`, tag, release or deploy publicly.
8. Make small signed-off Conventional Commits and push the branch after green checkpoints if GitHub authentication permits.
9. If the repository contains `.bootstrap/` or one-time workflows named `bootstrap-*` or `verify-*-payload`, treat them as failed transfer artifacts. Remove them in a dedicated cleanup commit before implementation. Preserve genuine project files.

## Read before coding

Read, in this order:

- `AGENTS.md`
- `README.md`
- `docs/VISION.md`
- `docs/PRODUCT_REQUIREMENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN_SYSTEM.md`
- `docs/FIRST_RUN_SETUP.md`
- `docs/USERS_AND_PERMISSIONS.md`
- `docs/MESSAGES.md`
- `docs/PRIVACY_AND_SECURITY.md`
- relevant ADRs under `docs/decisions/`

If one of these is absent, report it, use the requirements in this file as the authority for the first slice, and create or restore only the minimum missing documentation needed to keep code and decisions synchronized.

## Required first slice

A new user must be able to:

1. start Samvev with one documented Docker Compose command;
2. open a polished first-run wizard;
3. choose Norwegian Bokmål or English and light, dark or system appearance;
4. create the installation owner and first household;
5. add at least three household people, with optional login and role/capability presets;
6. finish onboarding without AI, Homey, Home Assistant or a public domain;
7. pair a restricted shared display using a short-lived code;
8. sign in as a permitted member;
9. create a household message, choose household/display recipients, publish now or schedule it for tomorrow, set expiry, and preview it;
10. see the message appear and disappear at the correct time on the shared display without manual refresh;
11. edit or withdraw a scheduled message before publication;
12. see honest states such as scheduled, published, displayed, withdrawn, expired and failed;
13. retain the latest safe display projection during a temporary connection interruption and visibly mark it stale/offline;
14. use anonymized demo mode to experience the product immediately.

## UX and visual quality

The result must look deliberate, not like a generic admin template or a wall of text.

Use one shared token system with semantic light and dark palettes. Implement:

- **Nordic Soft Cards** as the visual language;
- **Action Board** as the message/action information model;
- **Timeline and Person Columns** as an optional shared-display morning layout;
- responsive profiles for phone, tablet/large shared display and compact Shelly Wall Display XL dimensions;
- large distance-readable type and touch targets on displays;
- clear `what / who / when / source or author / action` hierarchy;
- no important meaning conveyed only by color;
- externalized `en` and `nb` strings from the first component;
- reduced-motion and keyboard/focus support;
- empty, loading, error, offline, long-text and translated-text states.

Create a component workbench or Storybook-equivalent containing at least message cards, person badges, status badges, schedule controls, display header, empty state and offline indicator. Add visual regression screenshots for light and dark at phone, shared display and compact-display sizes.

Do not use stock dashboards as the final design. Use the documented concepts as direction and make a coherent implementable system.

## Technical direction

Start with the simplest coherent monorepo that can grow toward the documented architecture. Prefer:

- TypeScript web application for onboarding, member/message administration and shared display;
- PostgreSQL for durable state;
- a server/API layer with explicit authorization and versioned contracts;
- a restart-safe database-backed scheduler/worker for publication and expiry;
- Server-Sent Events for display updates with polling fallback;
- Docker Compose for web/API/worker/database as appropriate;
- automated migrations and seeded anonymized demo data.

You may simplify deployment by using a TypeScript full-stack framework for this first slice if it preserves clear domain boundaries and future extraction paths. Record the decision in an ADR. Do not create a distributed system merely to match a diagram.

Authentication may be first-party for the local pilot, but passwords must be securely hashed, sessions protected, and the first-admin claim endpoint must close after ownership is established. Display credentials must be restricted and independently revocable. Every query and mutation must enforce household scope server-side.

## Data model minimum

Implement durable records for:

- installation
- household
- person
- user account
- household membership
- capability grant or role preset
- display and display credential/pairing code
- message
- message audience/display target
- message lifecycle/publication
- display projection or delivery state
- audit event for security-relevant changes

Use timezone-aware timestamps and household timezone. Scheduling must remain correct across process restarts. Add indexes and constraints for scope, uniqueness and idempotency.

## Tests and evidence

Before declaring the slice complete, provide:

- unit tests for lifecycle and permissions;
- integration tests with PostgreSQL for scheduling, expiry and household isolation;
- end-to-end browser tests for onboarding, member creation, display pairing, scheduling, live publication, edit/withdrawal, light/dark and both locales;
- accessibility checks on primary screens;
- visual regression snapshots at the required device profiles;
- clean install test from an empty volume;
- restart test proving scheduled content is not lost;
- secret scan and dependency/security checks available to the stack;
- screenshots stored under an appropriate documentation/artifact path using fake data.

Do not mark a test as passing unless it was executed. Fix failures within scope instead of merely documenting them.

## Autonomous work protocol

1. Inspect the repository and host constraints.
2. Write a concise implementation plan and checklist into `docs/implementation/M1_FIRST_SLICE.md`.
3. Resolve architecture choices and add ADRs before large scaffolding.
4. Implement in vertical increments, keeping the application runnable.
5. Run tests after each checkpoint.
6. Review your own changes with `/review` or an equivalent dedicated review pass.
7. Correct all high- and medium-severity findings within scope.
8. Keep `README.md`, `.env.example`, install instructions and troubleshooting current.
9. Continue independently through ordinary implementation choices. Ask only when blocked by a missing external secret, an irreversible host action, or a product decision that cannot be safely inferred.
10. Do not stop after generating a plan or scaffold. Stop only when the acceptance test below is demonstrably runnable or a genuine external blocker remains.

## Acceptance demonstration

Provide a documented local demo in which:

- an administrator completes onboarding and creates a household with an adult and two child/limited people;
- one limited member with permission schedules: “Remember gym clothes tomorrow” for the kitchen display at 07:00;
- the kitchen display is paired as a restricted client and shows the scheduled card at the simulated/test time in both light and dark mode;
- another household cannot read or mutate the message;
- the author can edit or withdraw it before publication;
- the display shows live status and a stale indicator when disconnected;
- all content is available in English and Norwegian Bokmål;
- the UI is visually polished enough for a household pilot, with screenshots and no obvious placeholder styling.

Use a controllable test clock or documented accelerated demo mode; do not require waiting until the next real morning.

## Completion report

At the end, report:

- branch and final commit SHA;
- architecture decisions made;
- exact commands to start, reset and stop only Samvev;
- local URLs and selected ports;
- demo accounts and pairing procedure using fake credentials;
- tests/checks executed and their results;
- screenshots produced;
- files and services created;
- unresolved risks, deferred scope and next recommended issue;
- confirmation that no sibling project or host-global service was modified.

Do not merge or deploy. Leave the branch pushed and ready for human testing and review.
