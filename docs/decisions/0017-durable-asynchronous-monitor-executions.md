# ADR 0017: Durable asynchronous monitor executions

- Status: Accepted
- Date: 2026-09-13

## Context

Monitor setup, Test now and Run now were synchronous HTTP operations with a
fixed 180-second server deadline and a 210-second browser deadline. A local
multi-tool week-plan and weather task exhausted that server budget three times
in the M2.4 owner pilot. Closing or refreshing the page also discarded the
client-side view of an in-progress run and of a completed draft preview.

## Decision

Every interpretation, test, manual, smarter-quality and scheduled monitor run
is first persisted in `monitor_executions`. The initiating request returns `202`
with a stable execution ID. The worker claims queued rows with
`FOR UPDATE SKIP LOCKED`, runs the existing monitor service or engine, and
stores a terminal state. A partial unique index permits only one queued or
running execution per task. Repeated identical action requests return the
existing execution rather than starting parallel provider work.

The API projects the active execution and the latest current-revision terminal
execution with each task. The web client polls that durable state and can
reconnect after reload without starting work. Transport loss is a connection
state, not `AI_TIMEOUT`. Draft preview results are stored in the execution so a
completed Test now result survives navigation and reload. Existing revision
fences still supersede work when the task itself has changed.

The initial server-owned latency classes are based on provider capability,
selected internal quality and task/tool complexity, never on a model name:

| Class | Maximum runtime | Display estimate |
|---|---:|---:|
| Hosted/default | 180 seconds | about 1 minute |
| Local, simple | 300 seconds | about 2 minutes |
| Local, multi-tool/schedule/smarter | 600 seconds | about 5 minutes |

These finite values retain bounded execution. The ten-minute complex-local
class is justified by the three live failures at 180 seconds and the isolated
multi-tool measurements where provider inference dominated source latency. A
worker lease is always the selected maximum plus 60 seconds, leaving bounded
time for terminal persistence. Provider turns and the single existing quality
escalation share the one outer server deadline. Tool-specific network limits
remain unchanged.

Progress is an allowlisted server state: queued, preparing, fetching source,
fetching weather, analysing, validating and finalising. The UI only shows a
phase after the corresponding server event. It uses “Arbeider nå” and
“Fortsatt i arbeid”, a coarse estimate, and explains that the page may be left.
It may say local AI, but does not expose model names, tiers, reasoning,
endpoints or provider policy.

Timing audit stores queue wait, provider-turn count and duration, tool count,
web, location and weather duration, total duration, quality escalation and a
bounded timeout reason. Deterministic dependency refreshes use the same observer,
so an unchanged run still records the actual source work, and failed runs retain
whether an automatic quality escalation occurred. Tool and quality audits link
to the stable execution ID. No prompt, reasoning, raw source, model output,
credential or endpoint is added to execution telemetry.

Queued work survives a worker restart. A running provider conversation is not
claimed to be resumable: an abandoned execution becomes
`MONITOR_WORKER_INTERRUPTED` after its bounded lease and is recoverable through
the normal user action. M1 lifecycle publication continues in its separate
worker loop while a monitor execution is slow.

## Migration and rollback

Migration `014_monitor_durable_executions.sql` creates the execution queue and
indexes, and adds nullable execution links to monitor runs, tool audits and
quality audits. Existing tasks, runs and schedules are not rewritten.

Before rolling application code back, stop new monitor execution enqueueing and
allow queued/running executions to finish or reach their supported interrupted
state. Do not run an older worker concurrently with the durable worker. The
additive schema can remain in place during an application rollback; a database
restore requires the normal verified pre-deploy backup.

## Consequences

The browser no longer owns AI job lifetime. A valid result inside the selected
server window is accepted even if the original request or page is gone.
Operational deployment must treat app and worker as one candidate because the
API enqueue contract and worker queue consumer change together.
