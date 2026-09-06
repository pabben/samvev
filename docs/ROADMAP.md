# Roadmap

The roadmap describes outcomes, not fixed dates. Public issues are the source of implementation status.

## M0 — Open-source foundation

**Outcome:** A repository that contributors can understand and safely extend.

- project name, vision and scope
- license policy, DCO and governance
- multilingual foundation requirements
- privacy and security baseline
- five design concepts with light/dark behavior
- public issue templates and initial backlog
- initial architecture ADRs

## M1 — Multi-user messages and shared display

**Outcome:** A household can onboard several members and exchange timed messages through an attractive shared screen without AI.

- first-run wizard
- installation owner and household administrator
- people, logins, roles and capabilities
- shared-display pairing
- immediate and scheduled messages
- display publication, expiry and withdrawal
- live updates and offline/stale status
- one production-quality design concept in light and dark appearance
- anonymized demonstration data

## M2 — Durable AI tasks and notification engine

**Outcome:** A user can describe a monitor or briefing, inspect the resulting rule and receive trustworthy output.

- task schema and lifecycle
- run history and failure state
- website/PDF adapter
- deterministic change detection
- AI provider abstraction and structured extraction
- source evidence and uncertainty
- notice router
- generic webhook adapter
- Homey notification delivery
- first weekly-plan pilot

## M3 — iPhone, widgets and compact displays

**Outcome:** Personal information is available on iPhone, widgets and a tested Shelly Wall Display XL layout.

- native iPhone app shell
- authentication and household views
- push notifications and deep links
- Next, Remember Today and Household widgets
- shared design tokens
- Shelly Wall Display XL hardware prototype
- display-specific permissions and performance testing

## M4 — Calendars and household integrations

**Outcome:** Samvev can curate relevant calendar information without copying every private detail into the household view.

- Google Calendar
- Microsoft personal and work/school calendar connections
- ICS subscriptions for sports and public calendars
- household output calendar
- privacy-preserving busy/free publication
- Spond feasibility and supported integration path
- Google Keep share-sheet import
- Samsung Family Hub/browser validation
- Nest Hub TTS and cast validation
- optional agent-installed Home Assistant integration

## M5 — Household tasks and rewards

**Outcome:** Children and adults can claim work, complete it and contribute to personal or shared goals.

- assigned and claimable tasks
- collaboration tasks
- completion and optional approval
- individual rewards
- shared goals
- Homey events on approval or goal completion
- fair-use safeguards and no default child leaderboard

## M6 — Production self-hosting and managed hosting

**Outcome:** Non-developers can run Samvev safely themselves or choose an official hosted service.

- documented Docker Compose installation
- upgrade, backup and restore
- installation health checks
- migration policy
- observability
- data export and deletion
- hosted tenancy architecture
- optional AI quota and billing model
- support and incident processes

## Cross-cutting work

Every milestone includes:

- tests and accessibility
- English and Norwegian Bokmål
- light and dark appearance
- threat-model updates
- contributor documentation
- source and uncertainty handling for AI-derived content
