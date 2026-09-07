# Test the local M1

This is a synthetic local installation. Use fictional names and content only.
The runtime is already claimed; the separate QA command exercises a fresh
installation without resetting this runtime.

## Open and sign in

Start from the repository root:

```bash
bash scripts/m1.sh start
```

Open <http://127.0.0.1:4173>. Current synthetic accounts:

| Person | Email | Password | Role |
|---|---|---|---|
| Avery · example | `owner@pilot.invalid` | `Synthetic-pilot-pass-42` | Installation owner / household administrator |
| Robin · example | `limited@pilot.invalid` | `Synthetic-pilot-pass-42` | Limited member with message/schedule capabilities and explicit display grants |

Morgan is an adult profile and Sky a child profile without login. A fifth
synthetic teen from a browser control run is retained with the test history.
The final successful test display is `Kitchen · example`; its credential
exists only in the browser that paired it, so a new browser needs a new pairing.

## Pair a browser and send a message

1. Open <http://127.0.0.1:4173/display> in another browser profile or private
   window. Start pairing and leave its expiring code visible.
2. In the owner's window, open **Displays / Skjermer** and approve that code.
   Give the new browser a distinct name such as **Kitchen pilot · example**.
   The display becomes a restricted client automatically.
3. Open **People / Personer**, edit Robin's permissions, and select the newly
   paired display. Keep the limited role and its message/schedule capabilities.
4. Sign in as Robin in another member window. Create a message, select that
   display and publish immediately. The display updates without refreshing.
   A device-render acknowledgement means the browser rendered the card; it
   does not claim that a person read it.
5. Create **Remember gym clothes tomorrow**, choose tomorrow at **07:00**,
   choose an expiry, and review the localized Europe/Oslo preview. The message
   appears in **Planned / Planlagt**. Edit it, or withdraw it before publication.
6. Withdraw a published message to remove it live. A published message also
   disappears automatically at its expiry. History keeps its honest state.

The display settings control language, appearance and the optional person-column
layout. Member preferences are separate. Exercise **en / nb** and light, dark
and system appearance; wait for the visible saved confirmation before reloading.

## Demonstrate scheduling without waiting until tomorrow

```bash
bash scripts/m1.sh browser-test
```

This replays the documented fictional owner/Robin fixture against the runtime.
It pairs its own test browser, checks tomorrow-07:00 editing/withdrawal, then
commits a real schedule due in about 12 seconds and expiring about 32 seconds
after creation. The real worker publishes and expires it. The command also
checks live delivery, offline/reconnect, both locales/themes, and focused
permission/preference/cache regressions. It creates synthetic test history.

For the complete fresh-install and actual restart demonstration:

```bash
bash scripts/m1.sh qa-test
```

This recreates only the guarded `samvev-m1-qa-postgres-data` volume, tests the
explicit sample-household mode, then performs fresh onboarding with an owner,
adult and two limited profiles. It stops only `qa-worker` for 45 seconds and
checks that a missed publication window expires without publishing, while a
still-valid schedule publishes exactly once after restart and later expires.
The QA services have no host-published ports. See [QA evidence](M1_QA.md).

To test first-run setup manually on a new checkout, start an empty installation
and choose the household setup wizard. Refresh after claiming the owner to
observe resumable setup. The separate **sample household** action creates
clearly labelled demo data; its accounts use `admin@demo.invalid`,
`member@demo.invalid`, and `limited@demo.invalid`, with
`Synthetic-demo-pass-42`. These are different from the running pilot fixture.

## Offline, privacy and revocation

The automated browser checks disconnect the display and verify a visible stale
indicator. Only its safe projection is cached; individual expiry and the fixed
15-minute cache deadline continue to clear content. Reconnection refreshes the
projection before claiming Live. Privacy mode suppresses cards, and verified
online revocation clears the projection and credential. An offline device
cannot learn a new revocation until it reconnects, so the cache deadline bounds
that case.

## Stop or reset synthetic data

```bash
bash scripts/m1.sh stop
```

This preserves the runtime volume. To deliberately discard this project's
synthetic data, with `SAMVEV_DEMO_MODE=true` in the selected environment file:

```bash
bash scripts/m1.sh reset-demo --confirm-synthetic-demo
bash scripts/m1.sh start
```

The reset removes Samvev project volumes and test history. Do not use it for
retained data. Backup and rollback limitations are in [operations](M1_OPERATIONS.md).
