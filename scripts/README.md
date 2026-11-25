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

## Isolated design-review build and QA activation

`bash scripts/design-review-build.sh` archives the clean canonical publishing SHA
and builds into `.local/design-review/staged/<sha>-<id>/dist` in a separate,
network-isolated container. The existing image and dependency volume are reused
read-only, including the scoped `apps/web/node_modules` Vite installation; no installs occur. The LAN app, active `apps/web/dist`, database,
worker and dependency files are not build targets. Failed builds leave the active
artifact unchanged. This produces a staged proof, not publication evidence.

After review, `bash scripts/design-review-runtime.sh` explicitly activates that
staged proof under the operation lock. It first requires the staged pointer to match its retained build manifest and validates source/runtime/asset
identity and the resolved Compose environment, mounts and LAN ports. It quiesces
the worker, runs the canonical additive QA migrator, stops the app, then exchanges
complete artifact directories atomically on the same filesystem. The old artifact
is retained beside the stage. A legacy stdin (`compose.yaml,-`) override is recovered from the exact inspected QA configuration into a private explicit override; resolved equality is required with the QA profile enabled. Only `qa-app` is recreated, with startup command
`npm run dev:api`; its image, environment, mounts, ports, hostname and security
configuration must remain identical. The worker restarts with its original ID;
the database container and volume are preserved. General `npm run build` remains
unchanged.

An explicit provenance transition records the app ID/command change. Runtime,
migration and served-asset hashes must all match before final build provenance is
written. The final proof retains the actual staged build timestamp, builder image and stage-manifest hash. Existing capture/publication scripts accept only that activated proof.
Reload old browser tabs after activation: the new directory contains exactly the
new build, while previous chunks remain in the retained artifact for recovery.

If activation fails after promotion, the helper stops the app and restores the
previous asset directory by exchange. It does not reset/restore the database or
restart the forbidden build-on-start command. Preserve the stage and repair the
QA runtime forward; no valid capture proof is issued for a failed activation.
Do not delete retained artifacts or retry a partly consumed stage blindly.

Focused local checks (no LAN activation):

```bash
node --test scripts/design-review-provenance.test.mjs scripts/design-review-pipeline.test.mjs
bash -n scripts/design-review-build.sh scripts/design-review-runtime.sh
```
