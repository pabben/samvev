# Product requirements

Status: **Draft foundation requirements**

## 1. Product goals

Samvev must:

1. turn natural-language monitoring and briefing requests into visible, editable and durable tasks
2. support multiple household members and display accounts from the first usable release
3. publish useful results to personal and shared surfaces
4. support scheduled messages that do not require AI
5. integrate with Homey for notifications and selected functions
6. remain usable without Home Assistant
7. make Home Assistant setup agent-generated rather than a manual card-building requirement
8. offer a native iPhone app with home-screen widgets
9. be self-hostable and publicly developed
10. treat multilingual support and design quality as foundation requirements

## 2. Core entities

The initial domain model should include:

- **Installation**: one deployed Samvev environment
- **Household**: a privacy and sharing boundary
- **Person**: a household member, whether or not that person has a login
- **User account**: an authenticated identity linked to one or more persons/households
- **Role and capability grant**: server-enforced permissions
- **Display**: a paired, restricted client with its own view and locale
- **Source**: URL, document, calendar, webhook or integration endpoint
- **Task**: a durable rule describing when to fetch, interpret and publish
- **Run**: one execution attempt with logs and outcome
- **Notice**: a displayable or deliverable result
- **Message**: user-authored content, immediate or scheduled
- **Action**: a constrained operation a recipient may invoke
- **Household task**: assigned or claimable work item
- **Reward ledger and goal**: individual or shared progress
- **Integration connection**: scoped credentials and capabilities

## 3. Required user roles

The application must support at least:

- installation administrator
- household administrator
- adult/member
- child/limited member
- display/service account

Roles are starting templates. Effective capabilities must be explicit and enforceable server-side.

## 4. First-run setup

A new installation must provide a guided setup for:

- interface language and time zone
- installation owner
- first household name
- household members and optional age group
- which members receive their own login
- initial permissions
- selected design concept and light/dark/system appearance
- pairing a first shared display
- optional Homey and AI-provider connection
- a test message and delivery verification

The application must not require Homey, Home Assistant, a cloud AI provider or a public domain to complete local onboarding.

## 5. AI-created durable tasks

A user with permission must be able to describe a recurring or event-based instruction in natural language. The system must:

1. propose a structured rule
2. show source, frequency, conditions, recipients, destinations and retention
3. require confirmation before activation when the request creates recurring external access or cost
4. store the accepted rule independently of the chat session
5. allow list, inspect, edit, pause, resume and delete
6. record each run and expose failures
7. separate deterministic change detection from AI interpretation
8. retain source evidence and uncertainty in generated notices

Initial task types:

- scheduled briefing
- source-change monitor
- inbound webhook transformation

## 6. Notice delivery

Notices must support:

- personal app inbox
- shared display
- Homey notification/Flow adapter
- iPhone push in a later pilot increment
- widget snapshot
- optional Home Assistant publication

Each delivery must have state such as queued, delivered, displayed, acknowledged, expired or failed. “Displayed” must not be described as “read” unless a user explicitly acknowledges it.

## 7. Scheduled household messages

A permitted user, including a child account when enabled, must be able to:

- write a message
- choose recipients and/or a shared display
- publish now or schedule a start time
- choose an expiry time or duration
- preview shared-display presentation
- edit or withdraw before publication
- see publication status

The system must not automatically turn every message into a task or AI summary.

## 8. Shared display

The first shared display must be a responsive web client capable of:

- pairing with a short-lived code
- running full-screen on a tablet or browser
- receiving updates without manual refresh
- showing current, upcoming and important content with distance-readable hierarchy
- opening a source or detail view only when permitted
- offering a small set of safe touch actions
- switching between light, dark and system/scheduled appearance
- hiding personal or sensitive content by default
- continuing to show the latest safe cached state during a temporary connection loss

## 9. iPhone application and widgets

The native application must eventually support:

- authentication and household switching
- personal overview and inbox
- create/edit/pause tasks
- create and schedule messages
- household task claiming and completion
- deep links from notifications and widgets
- at least three widget configurations: Next, Remember Today and Household

Widgets supplement, but do not replace, push notifications for urgent content.

## 10. Homey

The first Homey integration must support:

- outbound notification through a user-configured Flow or supported API path
- inbound events through a webhook or adapter
- invoking an allowlisted Flow from a Samvev action
- per-connection capability selection and revocation
- clear test and error status

Safety-sensitive physical actions require explicit policy and, by default, user confirmation.

## 11. Optional Home Assistant integration

Home Assistant must remain optional. When used, Samvev should provide an agent-driven setup package or prompt that can:

- inspect available entities with permission
- back up relevant configuration
- install or update the integration idempotently
- generate a finished dashboard from Samvev design tokens and actual entities
- validate the result
- report every change and rollback path

The user must not be expected to hand-build cards or YAML as the normal product path.

## 12. Rewards and claimable tasks

Household administrators must be able to create:

- assigned tasks
- tasks one or more children can claim
- individual rewards
- shared household goals
- tasks with no reward
- approval-required or self-completing tasks

The default experience should emphasize personal progress and cooperation, not ranking children against one another.

## 13. Internationalization

- Initial locales: English (`en`) and Norwegian Bokmål (`nb`).
- Each user and display can choose its locale.
- Household time zone is independent of language.
- User-facing strings must be externalized.
- Dates, times, units, pluralization and accessibility labels must use locale-aware formatting.
- AI output language follows the intended recipient/display, while source content remains available unchanged.

## 14. Security and privacy

The system must:

- isolate households and personal scopes
- use least-privilege integration credentials
- avoid exposing provider secrets to clients
- maintain audit records for permission, integration and safety-sensitive changes
- provide configurable retention
- offer data export and deletion pathways
- prevent unclaimed installations from remaining publicly claimable
- avoid sending sensitive content to a cloud AI provider without a configured policy
- use anonymized fixtures and screenshots in the public repository

## 15. Design requirements

- Five structurally different design concepts are documented for validation.
- Every concept supports light and dark appearance.
- Components use semantic design tokens rather than hard-coded meaning by color alone.
- Shared-display content must be readable at typical kitchen/hallway distance.
- Mobile and wall-panel interfaces must avoid becoming a wall of text.
- Important states use hierarchy, icon/text and position—not color alone.
- Each surface may use a different layout while retaining common identity and data semantics.

## 16. Out of scope for the first runnable pilot

- a marketplace for third-party integrations
- a full public multi-tenant cloud billing system
- direct control of door locks without an explicit safety design
- guaranteed two-way Google Keep synchronization
- full Spond functionality without a validated supported integration path
- complete CarPlay application
- replacing native Homey or Home Assistant device management

## 17. Pilot acceptance scenario

The first complete scenario is:

1. An administrator completes onboarding and adds multiple members.
2. A child schedules a message for the kitchen display the next morning.
3. An adult creates a source monitor in natural language.
4. The rule is previewed and confirmed.
5. The source monitor detects a new or changed weekly-plan document.
6. AI extracts relevant events and things to bring without inventing missing details.
7. The shared display publishes the child message and relevant plan notice at the correct time.
8. The administrator receives a Homey notification.
9. The iPhone widget shows the next important item.
10. Every item links to its source or author and respects user/display permissions.
