# Connect a ChatGPT plan to Samvev

Open **More → AI → ChatGPT** (`/?tab=ai`) for readiness and one next step.
The guide downloads the two real companion files; its manual progress flags
are not server-confirmed authentication.

This preview uses a local browser companion because Samvev's LAN page must not
receive bearer or refresh tokens over clear HTTP. Run the helper on the machine
with the browser and Node.js 24. The helper can be copied there independently;
it does not need a Git checkout or Samvev server access.

Copy `scripts/chatgpt-connect.ts` and `scripts/chatgpt-connect-core.mjs` from the
published feature branch to the **same directory** on the browser machine. Use
GitHub over HTTPS for these source files; no provider credential is part of them.
With Node.js 24, run from that directory (no npm install is needed). Keep the
registration metadata in a private browser-machine directory. It contains the
issued client ID, VM host ID and, after a successful exchange, the verified
issuer/subject binding. It contains no access, ID or refresh token.

```sh
node ./chatgpt-connect.ts \
  --host-id '<VM-host-ID-from-Samvev>' \
  --registration "$HOME/.config/samvev/chatgpt-registration.json" \
  --output "$HOME/samvev-chatgpt-credential.json"
```

If a Samvev checkout is already present on that machine, the equivalent command
is `npm run ai:chatgpt-connect -- --host-id '<VM-host-ID-from-Samvev>'
--registration "$HOME/.config/samvev/chatgpt-registration.json" --output
"$HOME/samvev-chatgpt-credential.json"`.


Complete the OpenAI consent page. The helper validates the callback state,
nonce, issued client ID and signed identity, then writes a credential record
with mode `0600`. It records the issued client ID atomically before token
exchange. If that exchange is interrupted, run the same command again: it
starts fresh state, nonce and PKCE values while reusing only the token-free
registration metadata. It prints the authorization URL only for the initial
local flow and never prints tokens.

Copy the record over SSH to a private path on the Samvev VM. Substitute the VM
host and your normal SSH user; do not place the file in `docs/` or another Git
path.

```sh
scp "$HOME/samvev-chatgpt-credential.json" samvev-vm:/home/administrator/apper/samvev/.local/samvev-chatgpt-credential.json
ssh samvev-vm 'chmod 600 /home/administrator/apper/samvev/.local/samvev-chatgpt-credential.json'
```

On the VM, use the household ID and the account ID of the owner who granted
consent. The command verifies that this account is an active household manager,
validates the signed access token and scopes again, creates initial AI settings
when needed, and imports into the encrypted vault. For the public test runtime, run from the confirmed Samvev directory on its
server. The app's guide supplies the exact household and owner IDs; they are
private operator values, not examples to publish. The checked-in wrapper
selects only the healthy `samvev-m1` **app** service, validates its immutable
image and network, and runs a restricted one-shot importer with the existing
runtime database/vault. It never selects `qa-app` automatically.

```sh
cd /home/administrator/apper/samvev
bash scripts/chatgpt-import-runtime.sh --check \
  --household '<household-uuid>' \
  --owner-account '<owner-account-uuid>'
bash scripts/chatgpt-import-runtime.sh \
  --household '<household-uuid>' \
  --owner-account '<owner-account-uuid>' \
  --file .local/samvev-chatgpt-credential.json
```

`--check` performs readiness checks without reading/importing credentials or
calling a provider. A successful import does not prove inference works. Delete
the server transfer file after the importer reports success. For a deliberately
isolated synthetic QA import, use the separately configured QA CLI rather than
this public-runtime wrapper. Never transfer a real credential into a fixture.

After the server import reports success, also delete the original credential
record on the **browser machine**:

```sh
rm "$HOME/samvev-chatgpt-credential.json"
```

Keep only the mode-`0600`, token-free
`$HOME/.config/samvev/chatgpt-registration.json` file on the browser machine.
Samvev uses that registration metadata for reauthorization; it never needs the
deleted credential record again.

The stable runtime host identity is displayed by Samvev and stays owned by the
VM. Pass that exact `urn:uuid` value with `--host-id` on each connection and
reauthorization. An initial transfer record created without this option remains
importable, but the next authorization should use the VM identity shown by
Samvev. Run the same command with the retained `--registration` file when
Samvev reports `AI_REAUTHORIZATION_REQUIRED`. The transferred credential record
may stay deleted; recovery never requires that token-bearing file. Missing
scopes, account eligibility, a plan limit and revocation are separate safe
states. A temporary discovery or signing-key outage leaves the newest rotated
credential encrypted as `pending_validation`; Samvev blocks inference and
retries validation without reusing the rotated-out refresh token. An older
retained ID token is only an identity hint when a refresh response
does not return a new ID token; the newly signed access token remains the
authorization proof. A limit pauses further plan dispatches until the owner
explicitly resumes after checking
<https://chatgpt.com/settings/usage>. Samvev never falls back to an API key or a
different owner's registration.

The account and public preview must support the documented agent OAuth scopes
and Responses route. Automated tests inject a synthetic transport and make no
paid provider call. An owner must complete real OpenAI consent before live use.

## Google/Gemini assessment (2026-10-14)

Google Calendar connection is independent of Google AI subscriptions. Some
linked Google AI Pro/Ultra and Developer Program plans may include conditional
GenAI/Cloud credits. The unidentified name “Google Plus” establishes no specific
entitlement. Gemini still needs an API project/key and eligible Cloud Billing;
Prepay requires an active positive paid balance before eligible credits can be
used. No billing activation or purchase is part of this round.

Samvev has no implemented Gemini adapter. Adding it requires a separately
reviewed provider/vault/model/rate/usage implementation and actual account tests;
it is not an automatic fallback. Check the exact existing subscription before
considering it. Sources checked on the date above:
[Google Developer Program plans](https://developers.google.com/program/plans-and-pricing),
[program FAQ](https://developers.google.com/profile/help/faq),
[Gemini billing](https://ai.google.dev/gemini-api/docs/billing).

The VM identity and local companion follow the official
[self-hosted VM flow](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)
and [Sign in with ChatGPT guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).
Real owner consent and a separate successful model run are distinct evidence.
