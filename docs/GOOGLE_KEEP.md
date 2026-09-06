# Google Keep integration

## Current product position

Samvev should not promise general continuous two-way Google Keep synchronization until a supported API path is verified for the intended account types and operations.

## First useful integration

The first iPhone implementation should support a share extension:

```text
Google Keep -> Share -> Samvev
```

The user chooses how to import the content:

- household message
- personal note
- household task
- source/reference for an AI task

The import is a copy. Samvev must state clearly that later Keep edits will not automatically change the imported item.

## Later investigation

A separate issue should assess:

- supported official APIs and eligible account types
- read/write/update limitations
- authentication and review requirements
- list and checkbox preservation
- conflict handling
- data deletion and revocation

Unofficial libraries may be useful for experiments but must not be a required or silently enabled production dependency.

## Data handling

- Preserve the original author and import time when available.
- Let the user preview recipients before sharing to a household display.
- Do not import an entire Keep account by default.
- Do not send note content to an AI provider merely because it was imported.
