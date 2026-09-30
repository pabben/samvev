# Repository bootstrap scripts

## `qa-demo-admin-password.sh`

Prepares only the existing synthetic `samvev-m1` QA administrator for the
explicit design-review login `admin` / `admin`. The wrapper refuses containers
outside the exact Compose project and services, unhealthy QA services, a
different database/volume, non-demo runtime, nonlocal origin, live database
marker, disabled or missing account, and an account that is not bound as the
installation administrator. It updates only the password hash for the existing
internal `admin@demo.invalid` account and is idempotent.

Run it once before the Round 2 browser work and after every fresh synthetic demo
provisioning:

```bash
bash scripts/qa-demo-admin-password.sh
```

This does not alter general login schemas, new-password policy, the generic
demo seed, other users, household data, messages, people or integrations.

## `create-and-push-repository.sh`

Creates the public `pabben/samvev` repository with GitHub CLI, sets the remote and pushes the current branch. It requires an authenticated `gh` installation with repository creation permission.

Review the script before running:

```bash
bash -n scripts/create-and-push-repository.sh
./scripts/create-and-push-repository.sh
```

## `bootstrap-github.sh`

Creates standard labels, milestones and the initial issues from `scripts/issues.json` after the repository exists.

```bash
./scripts/bootstrap-github.sh pabben/samvev
```

The script checks for existing labels, milestones and exact issue titles to reduce duplication. Review created issues after execution.
