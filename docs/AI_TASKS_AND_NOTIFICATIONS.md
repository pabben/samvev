# AI tasks and notifications

## Principle

A conversational instruction becomes a durable, inspectable Samvev task. The chat provider does not remain responsible for remembering or running it.

## Example request

> Check the weekly plan for class 1A every morning. Alert us immediately if there is something special to bring, and show it on the family display until that day has passed.

## Proposed task structure

```json
{
  "title": "Class 1A weekly plan",
  "household_id": "hh_example",
  "owner_person_id": "person_example",
  "source": {
    "type": "url",
    "url": "https://example.invalid/weekly-plan"
  },
  "schedule": {
    "check": "0 * 6-22 * * *",
    "briefing": "45 6 * * *",
    "timezone": "Europe/Oslo"
  },
  "instruction": "Extract confirmed activities, deadlines and things to bring. Do not infer missing dates.",
  "triggers": [
    "new_document",
    "content_changed",
    "something_to_bring",
    "schedule_exception",
    "deadline"
  ],
  "audience": ["household"],
  "destinations": ["display:kitchen", "homey:administrator"],
  "status": "active"
}
```

The user sees a human-readable preview before activation.

## Task types

### Scheduled briefing

At a defined time, gather relevant authorized data and produce a short briefing.

### Source-change monitor

Fetch a source on schedule, compare stable fingerprints and invoke AI only when interpretation is needed.

### Webhook transformation

Receive a signed external event, map it to the common event model and optionally summarize it.

## Run lifecycle

```text
scheduled -> fetching -> unchanged
                    -> changed -> extracting -> validating -> publishing
                    -> failed
```

Runs record timestamps, source metadata, extraction version, model/provider when used, cost metadata where available, validation errors and deliveries.

## Source handling

- Preserve the original URL and fetch time.
- Store a content fingerprint.
- Retain the original document according to household policy and legal constraints.
- Distinguish “new source”, “changed source” and “AI interpreted differently”.
- Never announce a new document based only on a model's opinion.

## Structured AI output

AI output must use a versioned schema, for example:

```json
{
  "summary": "Trip day on Tuesday and physical education on Thursday.",
  "important": true,
  "items": [
    {
      "date": "2026-09-08",
      "person_ref": "child_a",
      "activity": "Trip day",
      "bring": ["outdoor clothing", "drink bottle", "sitting pad"],
      "source_evidence": ["page:1:block:7"]
    }
  ],
  "uncertainties": []
}
```

The server rejects invalid output and avoids publishing unsupported dates or identities.

## General notice model

```json
{
  "title": "Trip day on Tuesday",
  "body": "Remember outdoor clothing, a drink bottle and a sitting pad.",
  "importance": "important",
  "audience": ["household"],
  "display_from": "2026-09-07T18:00:00+02:00",
  "expires_at": "2026-09-08T18:00:00+02:00",
  "source": {
    "label": "Weekly plan",
    "url": "https://example.invalid/source",
    "retrieved_at": "2026-09-06T18:10:00+02:00"
  },
  "uncertainty": "confirmed",
  "actions": ["open_source", "mark_prepared", "remind_later"]
}
```

The same model supports school, sport, travel-price, server, calendar and smart-home notices.

## Delivery rules

- A shared display receives household-safe content only.
- Urgent items use push/notification channels in addition to widgets.
- Repeated briefings should update or group an existing notice rather than create spam.
- Delivery failure is visible and retryable.
- The system should explain why a notice was generated and which rule produced it.

## ChatGPT/MCP tools

A minimal authenticated tool set can include:

```text
create_task_draft
confirm_task
list_tasks
get_task
update_task
pause_task
resume_task
delete_task
publish_message
```

Creating a draft and confirming activation should remain separate operations for recurring monitoring, external access or expected cost.
