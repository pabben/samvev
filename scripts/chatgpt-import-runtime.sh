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

install -d -m 700 "$ROOT/.local"
operation_dir="$(mktemp -d "$ROOT/.local/chatgpt-runtime-import.XXXXXX")"
chmod 700 "$operation_dir"
inspect_file="$operation_dir/inspect.json"
env_file="$operation_dir/runtime.env"
cleanup() { rm -rf -- "$operation_dir"; }
trap cleanup EXIT
docker inspect "${app_ids[0]}" >"$inspect_file"
chmod 600 "$inspect_file"

readarray -t runtime < <(python3 - "$inspect_file" "$ROOT" <<'PYTHON'
import json
import os
import re
import sys

inspection_file, root = sys.argv[1:]

def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(2)

try:
    with open(inspection_file, encoding='utf-8') as handle:
        inspected = json.load(handle)
except (OSError, json.JSONDecodeError):
    fail('Invalid public app inspection.')

if not isinstance(inspected, list) or not inspected or not isinstance(inspected[0], dict):
    fail('Missing public app inspection.')
value = inspected[0]
config = value.get('Config') if isinstance(value.get('Config'), dict) else {}
labels = config.get('Labels') if isinstance(config.get('Labels'), dict) else {}
if labels.get('com.docker.compose.project') != 'samvev-m1' or labels.get('com.docker.compose.service') != 'app':
    fail('Refusing a container outside the public samvev-m1 app service.')
if labels.get('com.docker.compose.project.working_dir') != root:
    fail('Public app working directory does not match this Samvev checkout.')
state = value.get('State') if isinstance(value.get('State'), dict) else {}
health = state.get('Health') if isinstance(state.get('Health'), dict) else {}
if state.get('Running') is not True or health.get('Status') != 'healthy':
    fail('Public app is not healthy.')
image = config.get('Image') if isinstance(config.get('Image'), str) else ''
if re.fullmatch(r'samvev-m1/runtime:[a-f0-9]{40}', image) is None:
    fail('Public app is not using an immutable Samvev runtime image.')
environment = {}
for line in config.get('Env') if isinstance(config.get('Env'), list) else []:
    if isinstance(line, str) and '=' in line:
        key, value_text = line.split('=', 1)
        environment[key] = value_text
if not environment.get('DATABASE_URL'):
    fail('Public app database configuration is unavailable.')
vault_destination = environment.get('SAMVEV_AI_MASTER_KEY_FILE') or '/run/secrets/samvev-ai-master-key'
if not vault_destination.startswith('/run/secrets/') or '\n' in vault_destination:
    fail('Public app AI vault path is unsafe.')
mounts = value.get('Mounts') if isinstance(value.get('Mounts'), list) else []
mount = next((item for item in mounts if isinstance(item, dict) and item.get('Destination') == vault_destination), None)
if mount is None or mount.get('Type') != 'bind' or mount.get('RW') is not False or not isinstance(mount.get('Source'), str):
    fail('Public app does not have the required read-only AI vault mount.')
vault_source = mount['Source']
relative = os.path.relpath(vault_source, root)
if relative == '.' or relative == '..' or relative.startswith('..' + os.sep) or os.path.isabs(relative) or not relative.startswith('.local' + os.sep):
    fail('AI vault source is outside protected Samvev local storage.')
if not os.path.exists(vault_source):
    fail('AI vault source is unavailable.')
network_settings = value.get('NetworkSettings') if isinstance(value.get('NetworkSettings'), dict) else {}
networks_value = network_settings.get('Networks')
networks = list(networks_value) if isinstance(networks_value, dict) else []
if len(networks) != 1:
    fail('Public app must have exactly one project network.')
runtime_user = config.get('User') or 'node'
if runtime_user not in ('node', '1000:1000'):
    fail('Public runtime user is not an expected unprivileged user.')
for result in (image, networks[0], runtime_user, vault_destination, vault_source):
    print(result)
PYTHON
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
python3 - "$inspect_file" "$env_file" "$vault_destination" <<'PYTHON'
import json
import os
import sys

inspection_file, output_file, vault_destination = sys.argv[1:]
with open(inspection_file, encoding='utf-8') as handle:
    value = json.load(handle)[0]
environment = {}
for line in value['Config'].get('Env', []):
    if isinstance(line, str) and '=' in line:
        key, value_text = line.split('=', 1)
        environment[key] = value_text
descriptor = os.open(output_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
    handle.write(f"DATABASE_URL={environment['DATABASE_URL']}\n")
    handle.write(f"SAMVEV_AI_MASTER_KEY_FILE={vault_destination}\n")
PYTHON
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
