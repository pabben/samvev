# Samvev Voice

Status: **Planned provider-independent voice layer**

## Goal

Samvev Voice lets household members create messages, ask for briefings, claim tasks and invoke explicitly allowed household actions by speaking. Voice is an input and output channel; durable schedules, authorization and business rules remain on the Samvev server.

## Initial path

The first implementation should expose push-to-talk in the shared web display and later in the iPhone app. It must show the transcription and proposed action before executing anything consequential.

Initial intents:

- read today's or tomorrow's household briefing
- create or schedule a household message
- add an item to a list
- create or claim a household task
- show the shared display's important items
- invoke an allowlisted Homey Flow

## Adapter strategy

All voice clients use one versioned Samvev Voice API. Potential adapters include:

- iPhone and Siri/App Intents
- shared-display microphone
- Homey-triggered briefings and text-to-speech
- Google Nest Hub for fixed commands, cast and speech output
- Alexa skills where supported
- Bixby/Samsung experiments where supported
- Home Assistant Assist as an optional local voice stack
- a later local wake-word satellite

No vendor-specific assistant is the source of truth.

## Safety and identity

Shared microphones may not reliably identify the speaker. Low-risk questions can be answered without identity. Personal data, reward approval, administrative changes and safety-sensitive physical actions require the relevant capability and stronger confirmation.

Raw audio should not be retained by default. Store a transcription only when it becomes a message, task, audit entry or explicitly retained history. The interface must visibly indicate when listening is active.
