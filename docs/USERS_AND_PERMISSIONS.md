# Users and permissions

## Person is not the same as account

A **person** represents someone in the household. A **user account** is an authenticated identity. A young child may be a person without an account; an older child may later receive an account linked to the same person.

## Starting role templates

### Installation owner

Can manage installation-wide settings and every household function, including
people, accounts, capabilities, displays, integrations and AI settings. Only an
existing installation owner may assign this role. Samvev prevents demotion or
deactivation of the last usable installation owner.

### Household administrator

Can manage household membership, accounts, permissions, messages, displays,
integrations, retention, household-wide tasks and AI settings. It cannot grant
installation-owner access.

### Adult/member

Can see permitted household information, create personal content and use capabilities explicitly granted by an administrator.

### Child/limited member

Can receive age-appropriate information, claim tasks, report completion and create or schedule messages according to household policy.

### Display/service account

Can fetch only the display projection or integration functions assigned to it. It cannot browse the household database or administer users.

## Capability examples

```text
household.view
household.manage
message.create.personal
message.create.household
message.publish.display
message.schedule
monitor.create
monitor.manage.own
monitor.manage.household
task.claim
task.complete
task.approve
reward.manage
display.manage
integration.homey.invoke.allowed_flow
integration.manage
```

Role templates grant capabilities, but administrators can adjust them. Sensitive capabilities should require recent authentication.

The implemented administrator templates are exact capability sets. Adult/member
and restricted/child templates do not gain administration capabilities merely
because a login exists. A person remains a separate record from its optional
account, and an owner may add an account to an existing profile later.

## Visibility scopes

- `personal`: visible only to its owner and authorized administrators where legally and operationally appropriate
- `people`: selected people
- `household`: all household members with general household access
- `display_group`: selected shared displays
- `service`: system or integration diagnostics

## Shared-display privacy

A shared display receives a server-created view model containing only permitted fields. Examples:

- a work calendar may expose “Pabben is busy until 14:00” without meeting title or participants
- a private notification must not be downloaded to the kitchen display
- a source URL requiring private authentication may open only on an authorized personal device

## Child agency and safety

Child accounts should:

- understand what will be shown and where
- be able to edit or withdraw their own scheduled message before publication
- see who approved or changed their tasks
- avoid hidden scoring or public ranking by default
- have clear limits rather than controls that silently fail

Adult oversight should not require that every harmless message is manually approved. Households choose direct publication or approval rules.

## Audit

Audit history is required for:

- role and capability changes
- integration connection and revocation
- display pairing
- safety-sensitive action invocation
- edits to another person's scheduled content
- reward ledger corrections

Audit records must not become a second copy of sensitive message bodies unless needed and documented.
