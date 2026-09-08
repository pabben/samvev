# Samvev

> Everyday life, woven together.

**Samvev** is a free and open-source platform for turning information into useful, timely messages, reminders and actions for a household or other small group.

A user should be able to write something such as:

> Check the weekly plan for class 1A. Give us a short update every morning, notify us immediately when something important changes, and show anything we must remember on the kitchen display.

Samvev stores that as a durable task, monitors the source, uses an approved AI provider only where interpretation is needed, and routes the result to the right people and surfaces.

## Project status

**M1 passes acceptance with Git delivery verified. M2.2 adds configurable OpenAI and local OpenAI-compatible AI providers; there is no production release.**

The first runnable slice includes household setup, people and roles, paired displays, immediate and scheduled messages, English and Norwegian Bokmål, and light and dark modes. Start with the [local demo](docs/implementation/M1_DEMO.md), [delivery evidence](docs/implementation/M1_DELIVERY.md) and [operations guide](docs/implementation/M1_OPERATIONS.md). The wider product vision below describes future capabilities; M1 does not implement external integrations, AI, native iOS, rewards or voice.

M2.2 extends the M2.1 foundation with an admin-configured local/OpenAI-compatible Chat Completions endpoint, routine and strong models, an optional encrypted key, connection testing, usage records and LAN-aware SSRF protection. AI starts disabled. ChatGPT subscription feasibility remains partial and unavailable. See the [M2.2 delivery note](docs/implementation/M2_2.md), [M2.1 foundation](docs/implementation/M2_1.md) and [provider architecture decision](docs/decisions/0012-ai-provider-foundation.md). The weekly-plan monitor is not implemented.

[Les introduksjonen på norsk](README.nb.md)

## What Samvev is

Samvev is not a school-plan app and not a replacement for Homey or Home Assistant. It is a general coordination layer that can connect:

- AI-created monitoring and briefing tasks
- scheduled household messages
- shared and personal dashboards
- iPhone notifications and home-screen widgets
- Homey notifications, Flows and events
- optional Home Assistant integration
- calendars, websites, PDFs, webhooks and later additional services
- claimable household tasks, individual rewards and shared goals

The first school-plan monitor is a useful pilot because it exercises the complete chain from source detection to AI interpretation, notification, source traceability and a shared display.

## Core principles

1. **Useful before clever.** Deterministic code handles schedules, source changes, permissions and delivery. AI interprets and summarizes; it does not replace reliable control logic.
2. **Multi-user from the beginning.** Personal, household and display scopes are separate and enforced by the server.
3. **Design is part of the product.** Mobile, shared display and compact wall-display experiences are designed together, with light and dark modes.
4. **Homey is a first-class integration.** Home Assistant remains optional and must not be a prerequisite.
5. **Self-hosting stays complete.** The software can be used without paying a Samvev subscription. Optional managed hosting may later sell convenience, operations and support.
6. **Open improvements.** The server, web app and display clients are planned under AGPL-3.0-or-later so network-hosted modifications remain available to their users.
7. **Source before summary.** AI-derived notices retain the original source, extraction time and uncertainty state.
8. **Child-safe defaults.** Shared screens reveal only explicitly permitted information; children receive age-appropriate capabilities without losing agency.
9. **Multilingual by architecture.** Norwegian Bokmål and English are the first locales, not hard-coded assumptions.
10. **Provider-independent AI.** Cloud and local providers should use the same constrained tools and schemas.

## Planned product surfaces

| Surface | Primary purpose |
|---|---|
| iPhone app | Personal overview, notifications, messages, AI tasks and household actions |
| iPhone widgets | Next important item, things to remember and household notices |
| Shared web display | Distance-readable household overview for kitchen, hallway, fridge or large screen |
| Shelly Wall Display XL view | Compact, location-aware status and quick actions |
| Web administration | Onboarding, integrations, permissions, task rules and display configuration |
| ChatGPT/MCP connection | Create, inspect, pause and update durable Samvev tasks from natural language |

## Documentation map

- [Product vision](docs/VISION.md)
- [Product requirements](docs/PRODUCT_REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [First-run setup](docs/FIRST_RUN_SETUP.md)
- [Users and permissions](docs/USERS_AND_PERMISSIONS.md)
- [AI tasks and notifications](docs/AI_TASKS_AND_NOTIFICATIONS.md)
- [Scheduled messages](docs/MESSAGES.md)
- [Rewards and task board](docs/REWARDS_AND_TASK_BOARD.md)
- [Integrations](docs/INTEGRATIONS.md)
- [Design system and five concepts](docs/DESIGN_SYSTEM.md)
- [Privacy and security](docs/PRIVACY_AND_SECURITY.md)
- [Initial issue backlog](docs/backlog/INITIAL_ISSUES.md)

## Repository direction

The proposed monorepo layout is:

```text
apps/
  web/            Shared display and administration
  ios/            iPhone app and WidgetKit extension
services/
  api/            Authorization, households, messages and public API
  worker/         Schedules, source monitoring and AI jobs
packages/
  contracts/      Versioned event, notification and tool schemas
  design-tokens/  Shared semantic tokens for light/dark themes
integrations/
  homey/
  home-assistant/
  web-source/
  webhook/
```

M1 implements the web/API/worker/contracts subset. The iOS and integration directories remain planned. See [Architecture](docs/ARCHITECTURE.md) and [ADR 0011](docs/decisions/0011-typescript-m1-postgresql-scheduler.md) for the current M1 decision.

## M1 local development

The first runnable M1 slice uses a project-scoped Docker Compose stack. Start it with:

```bash
bash scripts/m1.sh start
```

It binds the local app only to `http://127.0.0.1:4173`; PostgreSQL is not
published to the host. See [M1 local operations](docs/implementation/M1_OPERATIONS.md)
for scoped status, logs, tests, synthetic-data reset and rollback guidance.

## Contributing

Contributions are welcome from developers, designers, translators, testers and documentation writers.

Start with:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md)
- issues labelled `good first issue` or `help wanted` once the GitHub backlog is published

Contributions use the [Developer Certificate of Origin 1.1](DEVELOPER_CERTIFICATE_OF_ORIGIN.md) sign-off process.

## Licensing

- Server, worker, web and display code: **AGPL-3.0-or-later**
- Planned iOS app and WidgetKit extension: **MPL-2.0**, unless a later documented decision changes this before release
- Documentation and original documentation artwork: **CC BY-SA 4.0**, unless otherwise stated
- Names and logos are governed separately; no registered trademark is claimed by this repository

See [LICENSE_POLICY.md](LICENSE_POLICY.md). Third-party components retain their own licenses.

## Managed hosting

A future managed service may charge for hosting, backups, upgrades, monitoring, support and optional AI usage. The goal is to sell operational convenience rather than withhold core features from self-hosted users.

## Name status

**Samvev** is the current project name. It is a Norwegian word suggesting that separate threads are woven together. Formal trademark and domain clearance has not yet been completed.
