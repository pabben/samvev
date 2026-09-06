# Repository bootstrap scripts

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
