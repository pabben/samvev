# M1 final release review

Reviewed 2026-09-07 UTC by the read-only `release_gate` project agent, run last
after sequential fixes, complete QA and coordinator verification.

**PASS — local M1 acceptance passed; the sole Git delivery blocker is resolved.**

The reviewer found no additional confirmed high- or medium-severity local
defect. The implementation, final execution evidence and running services
support local acceptance. Historical failures remain explicitly distinguished
from the final passing results.

## Git delivery resolved — external verification, 2026-09-07 UTC

The user supplied direct GitHub verification of the completed host-shell
delivery and instructed the coordinator to close the sole remaining blocker.
Together with the prior local acceptance PASS and absence of any other
blocking finding, this changes the release gate from BLOCKED to **PASS**.

| Verification evidence supplied by the user | Result |
|---|---|
| Draft pull request | [PR #1](https://github.com/pabben/samvev/pull/1) |
| Work branch | `feat/m1-first-runnable-slice` |
| Remote head | `5e1f384cf8b4322454ea5a200ae457db6738b764` |
| PR state | Open, draft, mergeable |
| GitHub Documentation checks | Success |

This is externally supplied verification, not a claim that Codex reran GitHub
checks or application tests in this update. The earlier sandbox restriction
remains a local constraint; it no longer blocks delivery completed from the
host shell. The earlier unsuccessful observations below are historical and
superseded by this confirmation. The PR has not been merged by the coordinator.

Only M1_RELEASE_GATE.md, M1_DELIVERY.md and M1_STATUS.md are updated here.
Earlier checklist and JSON evidence snapshots remain unchanged under that
explicit scope. No application code or tests were changed, no tests were run,
and no commit or push was attempted from the sandbox.

## Historical Git delivery follow-up — resolved

The user reported completing the implementation commit, work-branch push and
draft PR from a normal host shell. Read-only verification in this follow-up
did not confirm that delivery. Both Git transport and GitHub API exposed
the previous branch tip, and both PR interfaces returned an empty list.
The conditional change to PASS could not be made at that time. No new local
implementation defect was found or asserted by this Git-only follow-up.

| Read-only command | Observed result |
|---|---|
| `git --no-optional-locks ls-remote --heads origin refs/heads/feat/m1-first-runnable-slice refs/heads/main` | Work branch `5bd4f0416efb3eaeb88a34e456d1f075de463ac9`; main `f82dd8208c0a169a21226fe4af81fb7e9dc62d09` |
| `gh repo view pabben/samvev --json nameWithOwner,url,defaultBranchRef` | Repository `pabben/samvev`, default branch `main` |
| `gh api repos/pabben/samvev/git/ref/heads/feat/m1-first-runnable-slice` | Same work-branch SHA `5bd4f0416efb3eaeb88a34e456d1f075de463ac9` |
| `gh api repos/pabben/samvev/commits/feat/m1-first-runnable-slice` | Existing `fix: target Codex window for tmux exit handling`, committed `2026-09-06T22:43:09Z`, with its existing sign-off; no new implementation tip |
| `gh pr list --repo pabben/samvev --head feat/m1-first-runnable-slice --base main --state all` | Empty list; no matching draft PR verified |
| `gh pr list --repo pabben/samvev --state all --limit 100` | Empty list, including without branch/base filters |
| `gh api --method GET repos/pabben/samvev/pulls -f state=all -f per_page=100` | Empty list from the REST endpoint as well |
| `git --no-optional-locks ls-tree -r --name-only 5bd4f0416efb3eaeb88a34e456d1f075de463ac9 -- apps services packages compose.yaml docs/implementation/M1_RELEASE_GATE.md` | No implementation paths in the object matching the observed remote tip |

PR commands used JSON output; API commands selected the relevant fields with
`--jq`. All commands completed successfully; the delivery assertions failed
because the expected new remote commit and draft PR were absent from results.
Local branch, remote URL, log, status and unstaged-diff reads were also checked.
The sandbox then reported the previous HEAD and staged implementation files;
those remote conclusions used `ls-remote` and GitHub API, not cached tracking refs.

A PR URL was requested to resolve the discrepancy with the host-shell report.
No commit, push, fetch, merge or Git metadata repair was attempted. This follow-up
updated only M1_RELEASE_GATE.md, M1_DELIVERY.md and M1_STATUS.md; prior checklist
and evidence artifacts remained unchanged. Application tests were not rerun for
this documentation-only verification.

## Original sole blocker — historical review, resolved by host-shell delivery

The required signed-off implementation commit, work-branch push and draft PR
could not be produced from the sandbox while `.git` was mounted read-only.
The reviewer independently confirmed the writable worktree/read-only Git
distinction through `os.statvfs`.
No mutation or bypass was attempted.

- Branch: `feat/m1-first-runnable-slice`.
- Unchanged existing HEAD: `5bd4f0416efb3eaeb88a34e456d1f075de463ac9`.
- Implementation then remained working-tree changes; no implementation commit,
  push or draft PR had been verified.
- Release-PASS, pushed-commits and draft-PR checklist items were left unchecked
  in that historical snapshot.

At that review, normal workspace Git metadata write access was needed to
complete delivery from the sandbox. A [concrete PR draft](M1_PR_DRAFT.md) was
prepared but not submitted by the coordinator. The later host-shell delivery
report and its initially unsuccessful remote verification are recorded above.
The current external confirmation resolves that delivery blocker without
changing sandbox permissions.

## Execution evidence and independent verification

The reviewer distinguished prior executed tests from checks independently
performed during this read-only review; it did not rerun mutating QA.

| Check | Evidence/result |
|---|---|
| Unit/integration execution | Reviewed coordinator's raw `scripts/m1.sh test` log: 18 passed, zero failures/skips/todos |
| Complete fresh QA execution | Final `qa-test` evidence: explicit demo, fresh setup, 17 smoke, 10 focused and 10 UX checks; actual worker restart and normal visual comparison |
| Retained-runtime execution | Final `browser-test` evidence: 16 smoke and 10 focused checks |
| Restart ledger | Independent scoped SQL query: missed message scheduled → expired; recovery scheduled → published → expired |
| Visual pixels | Independent standard-library PNG decode/recomparison: all 12 profiles have zero changed pixels outside approved masks |
| Visual provenance | Candidate/baseline/final hashes and dimensions match manifests; original baseline images unchanged; exactly four reviewed mask widths increased one pixel |
| Rendered time text | Independently verified all 168 expected/actual matches across 12 profiles and both live/capture scopes |
| Migration ledger | All four runtime migration checksums independently match SQL source |
| Container safety/health | Exact project-label inspection: runtime and QA healthy; no privileged containers, host networking or socket mounts; Git mounts read-only |
| HTTP | Health, member/display/workbench pages and current assets return 200; anonymous member/projection APIs return 401 |
| Runtime | Node 24.20.0, PostgreSQL 17.11, five synthetic people, four migrations, one active display |
| Static operations checks | Shell syntax, scoped Compose configuration and `git diff --check` passed |
| Audit/data evidence | Reviewed zero-vulnerability audit and final scan: 123 text files, 33 artifact JSONs, no recorded secret/auth-field findings; 85 local links, none broken |

The reviewer personally inspected the final mobile, 16:9, Shelly XL,
two-author columns, retained-error composer and Norwegian account-state
screenshots. Security source spot checks supported the documented fixes for
household scope, restricted displays, session/CSRF protection, pairing, ACK
scope, bounded realtime delivery and safe cache expiry.

Evidence: [delivery](M1_DELIVERY.md), [QA](M1_QA.md),
[coordinator verification](artifacts/coordinator/final-verification.json),
[raw independent tests](artifacts/coordinator/unit-integration.log),
[final visual comparison](artifacts/qa-final/visual-comparison.json),
[artifact provenance](artifacts/README.md).

## Limits and handoff

Physical iPhone/Shelly hardware and actual backup restoration remain untested
and documented. This acceptance concerns the local, loopback-bound M1. Broader
integrations and production readiness are not claimed.

The release reviewer changed no files or runtime data. The coordinator recorded
this report and updated delivery status afterward; no production source or
test behavior changed. No real secret or private household data, sibling
project change, host-global change, merge, tag, release or production deployment
was introduced.
