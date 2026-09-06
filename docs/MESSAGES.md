# Household messages

Messages are first-class content and do not require AI.

## Core flow

A household member can:

1. write a message
2. choose people and/or displays
3. publish now or select a future start time
4. choose expiry or “until acknowledged” where permitted
5. preview the shared-display card
6. send, edit or withdraw

Example:

> Remember that I need physical-education clothes tomorrow.

The sender chooses “Kitchen display”, “Tomorrow at 07:00” and “Hide at 10:00”.

## Message states

```text
draft -> scheduled -> published -> expired
                 \-> cancelled
published -> withdrawn
```

Delivery state is recorded separately. “Displayed by the device” must not be labelled “read by a person”.

## Recipients

- one person
- selected people
- entire household
- one or more display groups
- a combination, when policy allows

## Child accounts

A household administrator chooses whether a child may:

- publish directly to selected displays
- schedule messages
- attach images
- request an adult approval
- mark a message as requiring acknowledgement

The sender can edit or withdraw their own unpublished message. Edits by another user are visible in history.

## Presentation

A message card should show:

- author or household label
- when it becomes relevant
- short content
- optional icon/image
- optional acknowledgement or safe action

Shared displays should not present all messages as urgent. Visual importance is explicit.

## AI assistance

Optional AI may:

- convert “show this tomorrow morning” into a proposed schedule
- shorten a long message after showing the proposed edit
- translate for a recipient while preserving the original

AI must not silently alter the author's meaning or audience.
