# Optional Home Assistant integration

Home Assistant is useful but must not be required to run Samvev.

## Product requirement

The normal integration path should be **agent-built and validated**, not a guide that expects the user to manually create cards or write YAML.

## Intended outcomes

- publish Samvev notices, calendars, task lists and status as appropriate entities/events
- allow Samvev to invoke explicitly permitted Home Assistant services or scripts
- offer a generated dashboard using Samvev design tokens
- allow Home Assistant automations to react to Samvev events

## Agent-driven setup

An installation agent should:

1. confirm the target Home Assistant instance and access method
2. inspect available configuration and entities with least privilege
3. create a backup or snapshot of files it will change
4. generate an idempotent integration configuration
5. generate the dashboard from actual available entities
6. validate configuration before reload/restart
7. apply the smallest safe change
8. verify entities and dashboard rendering
9. provide changed files, checks and rollback instructions

A draft agent prompt is available in [`../prompts/home-assistant-dashboard-agent.md`](../prompts/home-assistant-dashboard-agent.md).

## Boundaries

- Home Assistant does not become Samvev's user or permission database.
- Samvev's own shared display remains available without Home Assistant.
- Broad admin tokens should be avoided when narrower integration credentials can work.
- Physical actions follow the same permission and confirmation model as Homey.

## Dashboard output

The generated dashboard should not be a generic wall of entity cards. It should select a documented Samvev layout concept and produce:

- current/next household information
- relevant reminders
- selected tasks/messages
- concise smart-home status
- light and dark behavior
- a screen-size profile

The agent must not invent entity IDs or claim completion without testing the target instance.
