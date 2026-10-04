# Connect a ChatGPT plan to Samvev

This preview uses a local browser companion because Samvev's LAN page must not
receive bearer or refresh tokens over clear HTTP. Run the helper on the machine
with the browser and Node.js 24. The helper can be copied there independently;
it does not need a Git checkout or Samvev server access.

Copy `scripts/chatgpt-connect.ts` and `scripts/chatgpt-connect-core.mjs` from the
published feature branch to the **same directory** on the browser machine. Use
GitHub over HTTPS for these source files; no provider credential is part of them.
With Node.js 24, run from that directory (no npm install is needed):

```sh
node ./chatgpt-connect.ts --host-id '<VM-host-ID-from-Samvev>' --output "$HOME/samvev-chatgpt-credential.json"
```

If a Samvev checkout is already present on that machine, the equivalent command
is `npm run ai:chatgpt-connect -- --host-id '<VM-host-ID-from-Samvev>' --output "$HOME/samvev-chatgpt-credential.json"`.


Complete the OpenAI consent page. The helper validates the callback state,
nonce, issued client ID and signed identity, then writes a credential record
with mode `0600`. It prints the authorization URL only for the initial local
flow and never prints tokens.

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
when needed, and imports into the encrypted vault. For the synthetic QA
environment in Compose project `samvev-m1`, run the import inside the existing
QA app container so it uses the QA database and mounted QA vault:

```sh
cd /home/administrator/apper/samvev
docker exec samvev-m1-qa-app-1 npm run ai:chatgpt-import -- \
  --household '<household-uuid>' \
  --owner-account '<owner-account-uuid>' \
  --file /workspace/.local/samvev-chatgpt-credential.json
rm /home/administrator/apper/samvev/.local/samvev-chatgpt-credential.json
```

The stable runtime host identity is displayed by Samvev and stays owned by the
VM. Pass that exact `urn:uuid` value with `--host-id` on each connection and
reauthorization. An initial transfer record created without this option remains
importable, but the next authorization should use the VM identity shown by
Samvev. Use `--reauthorize <old-record>` together with `--host-id
<VM-host-ID-from-Samvev>` when Samvev reports
`AI_REAUTHORIZATION_REQUIRED`. Missing scopes, account eligibility, a plan limit
and revocation are separate safe states. A limit pauses further plan dispatches
until the owner explicitly resumes after checking
<https://chatgpt.com/settings/usage>. Samvev never falls back to an API key or a
different owner's registration.

The account and public preview must support the documented agent OAuth scopes
and Responses route. Automated tests inject a synthetic transport and make no
paid provider call. An owner must complete real OpenAI consent before live use.
