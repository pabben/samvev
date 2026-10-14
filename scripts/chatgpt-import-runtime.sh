#!/usr/bin/env bash
# Import one consented ChatGPT companion record into the exact immutable public
# runtime. This is an operator command: it never runs from the app, worker, QA
# or review flows. --check performs discovery only and does not read a credential.
set -Eeuo pipefail
umask 077

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$ROOT" == "/home/administrator/apper/samvev" ]] || { echo 'Unexpected repository root.' >&2; exit 2; }

usage() {
  cat >&2 <<'USAGE'
Usage: bash scripts/chatgpt-import-runtime.sh --household UUID --owner-account UUID [--file /private/credential.json] [--check]

Discovers the single running public samvev-m1 app by Compose labels and imports
one 0600 companion credential through an isolated, read-only container using
the exact immutable runtime image and its existing read-only vault key.

--check verifies only runtime readiness. It never reads or imports a credential.
USAGE
}

household=''
owner_account=''
credential_file=''
check_only=false
while (($#)); do
  case "$1" in
    --household) household="${2:-}"; shift 2 ;;
    --owner-account) owner_account="${2:-}"; shift 2 ;;
    --file) credential_file="${2:-}"; shift 2 ;;
    --check|--dry-run) check_only=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

uuid_re='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
[[ "$household" =~ $uuid_re && "$owner_account" =~ $uuid_re ]] || { echo 'Household and owner account must be UUIDs.' >&2; exit 2; }
if ! "$check_only"; then
  [[ -n "$credential_file" && -f "$credential_file" && ! -L "$credential_file" ]] || { echo 'Credential file must be a regular non-symlink file.' >&2; exit 2; }
  [[ "$(stat -c '%a' -- "$credential_file")" == 600 ]] || { echo 'Credential file must have exactly 0600 permissions.' >&2; exit 2; }
  credential_file="$(realpath -- "$credential_file")"
fi

mapfile -t app_ids < <(docker ps --filter label=com.docker.compose.project=samvev-m1 --filter label=com.docker.compose.service=app --format '{{.ID}}')
[[ ${#app_ids[@]} -eq 1 ]] || { echo 'Expected exactly one running samvev-m1 public app service.' >&2; exit 2; }

operation_dir="$(mktemp -d "$ROOT/.local/chatgpt-runtime-import.XXXXXX")"
chmod 700 "$operation_dir"
inspect_file="$operation_dir/inspect.json"
env_file="$operation_dir/runtime.env"
cleanup() { rm -rf -- "$operation_dir"; }
trap cleanup EXIT
docker inspect "${app_ids[0]}" >"$inspect_file"
chmod 600 "$inspect_file"

readarray -t runtime < <(node - "$inspect_file" "$ROOT" <<'NODE'
const fs=require('node:fs');
const path=require('node:path');
const [,,file,root]=process.argv;
const value=JSON.parse(fs.readFileSync(file,'utf8'))[0];
const fail=message=>{process.stderr.write(`${message}\n`);process.exit(2);};
if(!value)fail('Missing public app inspection.');
const labels=value.Config?.Labels??{};
if(labels['com.docker.compose.project']!=='samvev-m1'||labels['com.docker.compose.service']!=='app')fail('Refusing a container outside the public samvev-m1 app service.');
if(labels['com.docker.compose.project.working_dir']!==root)fail('Public app working directory does not match this Samvev checkout.');
if(value.State?.Running!==true||value.State?.Health?.Status!=='healthy')fail('Public app is not healthy.');
const image=value.Config?.Image??'';
if(!/^samvev-m1\/runtime:[a-f0-9]{40}$/.test(image))fail('Public app is not using an immutable Samvev runtime image.');
const env=Object.fromEntries((value.Config?.Env??[]).map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1)];}));
if(!env.DATABASE_URL)fail('Public app database configuration is unavailable.');
const vaultDestination=env.SAMVEV_AI_MASTER_KEY_FILE||'/run/secrets/samvev-ai-master-key';
if(!vaultDestination.startsWith('/run/secrets/')||vaultDestination.includes('\n'))fail('Public app AI vault path is unsafe.');
const mount=(value.Mounts??[]).find(item=>item.Destination===vaultDestination);
if(!mount||mount.Type!=='bind'||mount.RW!==false||typeof mount.Source!=='string')fail('Public app does not have the required read-only AI vault mount.');
const relative=path.relative(root,mount.Source);
if(relative===''||relative.startsWith('..')||path.isAbsolute(relative)||!relative.startsWith('.local'+path.sep))fail('AI vault source is outside protected Samvev local storage.');
if(!fs.existsSync(mount.Source))fail('AI vault source is unavailable.');
const networks=Object.keys(value.NetworkSettings?.Networks??{});
if(networks.length!==1)fail('Public app must have exactly one project network.');
const user=value.Config?.User||'node';
if(!['node','1000:1000'].includes(user))fail('Public runtime user is not an expected unprivileged user.');
for(const result of [image,networks[0],user,vaultDestination,mount.Source])process.stdout.write(`${result}\n`);
NODE
)
[[ ${#runtime[@]} -eq 5 ]] || { echo 'Could not establish a safe immutable runtime import context.' >&2; exit 2; }
image="${runtime[0]}"
network="${runtime[1]}"
runtime_user="${runtime[2]}"
vault_destination="${runtime[3]}"
vault_source="${runtime[4]}"

if "$check_only"; then
  echo "ChatGPT runtime import readiness verified for immutable ${image#samvev-m1/runtime:}; no credential was read or imported."
  exit 0
fi

# The only values copied from the runtime are its database URL and exact vault
# path. The protected env file is deleted by the trap and is never printed.
node - "$inspect_file" "$env_file" "$vault_destination" <<'NODE'
const fs=require('node:fs');
const [,,file,out,vaultDestination]=process.argv;
const value=JSON.parse(fs.readFileSync(file,'utf8'))[0];
const env=Object.fromEntries((value.Config?.Env??[]).map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1)];}));
fs.writeFileSync(out,`DATABASE_URL=${env.DATABASE_URL}\nSAMVEV_AI_MASTER_KEY_FILE=${vaultDestination}\n`,{mode:0o600});
NODE
chmod 600 "$env_file"

docker run --rm --read-only --security-opt no-new-privileges --cap-drop ALL \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --network "$network" --user "$runtime_user" --workdir /workspace \
  --label com.docker.compose.project=samvev-m1 \
  --label com.samvev.component=chatgpt-runtime-import \
  --env-file "$env_file" \
  -v "$credential_file:/run/samvev-import/credential.json:ro" \
  -v "$vault_source:$vault_destination:ro" \
  "$image" npm run ai:chatgpt-import -- \
    --household "$household" --owner-account "$owner_account" --file /run/samvev-import/credential.json
