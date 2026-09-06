# iOS application and widgets

## Native application goals

The iPhone application provides the personal surface for:

- overview and inbox
- task creation and management
- scheduled household messages
- household task claiming/completion
- reward progress
- notification actions and deep links
- share-sheet import from apps such as Google Keep

## Navigation proposal

```text
Overview | Tasks | Messages | More
```

A prominent create action offers:

- New AI monitoring task
- New message
- New household task, when permitted

## Widget configurations

### Next

Shows the next important event, notice or departure for the selected scope.

### Remember Today

Shows a small number of actionable reminders for the user or selected household members.

### Household

A larger widget showing upcoming household items and unread/shared messages.

Widgets can be configured by household, person and privacy level.

## Widget behavior

- Use a server-prepared, authorized snapshot.
- Deep-link to the exact notice, source, task or message.
- Do not rely on the widget as an urgent real-time channel.
- Hide sensitive content when the device/widget privacy setting requires it.
- Show stale state when data cannot refresh.

## Push notifications

Push content should be concise and use categories such as informational, important, action required and safety-sensitive. Available actions depend on role and notice state.

## Share extension

The share extension accepts text, URLs and supported attachments. The user must choose destination and audience before household publication.

## Licensing

The planned native iOS and WidgetKit source is intended for MPL-2.0. This must be confirmed in an ADR before first public distribution.
