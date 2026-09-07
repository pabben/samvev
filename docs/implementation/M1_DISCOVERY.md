# M1 discovery

Date: 2026-09-06. Coordinator: implementation agent. Gate A completed before changes.

## Authority and scope

Read the complete `prompts/implementation-kickoff.md`, then `AGENTS.md`, README,
vision, product requirements, architecture, design system, first-run setup,
users/permissions, messages, privacy/security, all current ADRs, and display/i18n
and relevant design references. Required documents are present.

The latest user wrapper overrides the kickoff: Compose project is **samvev-m1**;
sudo is forbidden. Work is confined to `/home/administrator/apper/samvev` on
`feat/m1-first-runnable-slice`. No parent/sibling or host-global modifications,
unrelated Docker operations, merges, tags, releases or production deployment.

M1 implements multiple people/accounts/capabilities, immediate and scheduled
household messages, expiry/withdrawal, and paired restricted shared displays.
Broader product pilot references to AI, Homey, Home Assistant, calendars, Spond,
Keep, iOS, rewards and voice are deferred; no fake integrations will be added.

## Gate A reports

| Agent | Findings used in the plan |
|---|---|
| repo_scout | Documentation-only application; correct clean branch; no Compose stack or M1 docs; scoped Docker commands work |
| requirements_guardian | Traceable acceptance matrix, explicit capabilities, separate lifecycle/delivery, all execution evidence required |
| solution_architect | React/Vite + Fastify + PostgreSQL; separate worker; transactional schedules; browser-bound pairing; bounded safe projection cache |
| ux_designer | Nordic Soft Cards; Now/Planned/History; progressive setup; display-generated code; real 1280×752 landscape profile; 12-profile visual matrix |

## Independently verified environment

- `pwd`: required repository root.
- `git status --short --branch`: clean requested branch tracking origin.
- No tracked `.bootstrap/**`, `bootstrap-*` or `verify-*-payload*` workflows found.
  Prior cleanup commits exist; no new cleanup is necessary.
- `docker compose version`: v5.4.0.
- `docker ps --all --filter label=com.docker.compose.project=samvev-m1`:
  succeeds with no containers at discovery.
- Host `node` is absent. Build/install/test must use project-labeled containers;
  do not install host-global tools.
- `git ls-remote origin`: main and work branch reachable.
- `gh api user` succeeds; no existing draft PR for this work branch was returned.
  Push and PR creation still require actual successful execution at delivery.

## Product decisions and risks

- Three persistent services: app (same-origin web/API), worker, PostgreSQL.
  Compose tooling/test services may be added within the same project.
- Role presets store explicit grants. Child/limited accounts get only approved
  message capabilities and display targets. A person need not have an account.
- Pairing begins on the display. The short code is approved by a member with
  display management permission; a separate browser-bound secret redeems it.
- Displayed means a validated device render acknowledgement, never human read.
- Offline content has known expiry and a maximum 15-minute safe cache lifetime;
  explicit revocation clears it on reconnect. Offline revocation is not instant.
- User/display language and appearance are independent of household timezone.
- Browser tests at Shelly XL dimensions are M1 evidence, not hardware/firmware
  certification. Physical hardware validation remains a follow-up issue.
- First-party local authentication is a pilot foundation; recovery/MFA and broad
  retention/export management must be documented honestly if not in this slice.

No application tests or screenshot checks existed at discovery. No secret or
private household data was introduced by discovery.
