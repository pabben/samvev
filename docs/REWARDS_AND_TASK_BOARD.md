# Rewards and claimable household tasks

## Goal

Make household work visible and voluntary where appropriate, while supporting assigned responsibilities, individual rewards and shared goals.

## Task types

### Assigned task

One or more people are responsible from creation.

### Claimable task

Eligible children or members can press **I'll take this**. Claiming must be atomic so two people do not unknowingly take an exclusive task.

### Collaborative task

Several people can claim defined places or contribute progress.

### Routine without reward

Normal responsibilities can exist without points or prizes.

## Lifecycle

```text
available -> claimed -> reported complete -> approved -> rewarded
                 \-> released                 \-> changes requested
```

Administrators decide whether a task needs approval or can complete immediately.

## Reward models

### Individual

A child earns points, stars, money-equivalent credit where appropriate, or progress toward a selected reward.

### Shared

Completed tasks contribute to a household goal such as a film night, activity or shared treat.

### Combined

A task may contribute to both an individual and a shared goal, but the effect must be visible before claiming.

## Fairness requirements

- No public ranking between children by default.
- Show personal progress and household cooperation.
- Allow different task eligibility and values without implying a child's worth.
- Prevent duplicate rewards through an immutable ledger plus corrections.
- Show who created, claimed, approved or corrected an item.
- Let a child release a task with a reason when policy allows.
- Do not make all ordinary care or participation dependent on points.

## Display behavior

### iPhone

- Available tasks
- My tasks
- My rewards
- Shared goal

### Shared family display

- A limited list of available tasks
- Who has claimed an item
- Household goal progress
- Celebration when a goal is reached, respecting screen settings

### Shelly Wall Display XL

- Up to a few context-relevant tasks
- Large claim/complete controls
- No dense ledger or administration

## Homey integration

Optional events:

- notify an approver when completion is reported
- start an allowlisted celebration Flow when a shared goal is approved as reached
- publish a task when a household state occurs, subject to rate limits and duplicate prevention

## AI role

AI can suggest task wording, estimate ambiguity or propose a balanced set of tasks. It must not independently assign rewards, punish a child or change ledger values without a permitted human action.
