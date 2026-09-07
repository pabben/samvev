# M1 final release review

Reviewed 2026-09-07 UTC by the read-only `release_gate` project agent, run last
after sequential fixes, complete QA and coordinator verification.

**BLOCKED — local M1 acceptance PASS; reported Git delivery is not remotely verified.**

The reviewer found no additional confirmed high- or medium-severity local
defect. The implementation, final execution evidence and running services
support local acceptance. Historical failures remain explicitly distinguished
from the final passing results.

## Git delivery follow-up — 2026-09-07 UTC

The user reported completing the implementation commit, work-branch push and
draft PR from a normal host shell. Read-only verification in this follow-up
did not confirm that delivery. Both Git transport and GitHub API still expose
the previous branch tip, and both PR interfaces return an empty list.
The conditional change to PASS therefore cannot be made. No new local
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
The sandbox still reports the previous HEAD and staged implementation files;
remote conclusions above use `ls-remote` and GitHub API, not cached tracking refs.

A PR URL was requested to resolve the discrepancy with the host-shell report.
No commit, push, fetch, merge or Git metadata repair was attempted. This follow-up
updates only M1_RELEASE_GATE.md, M1_DELIVERY.md and M1_STATUS.md; prior checklist
and evidence artifacts remain unchanged. Application tests were not rerun for
this documentation-only verification.

## Original sole blocker — historical review

The required signed-off implementation commit, work-branch push and draft PR
cannot be produced while `.git` is mounted read-only. The reviewer independently
confirmed the writable worktree/read-only Git distinction through `os.statvfs`.
No mutation or bypass was attempted.

- Branch: `feat/m1-first-runnable-slice`.
- Unchanged existing HEAD: `5bd4f0416efb3eaeb88a34e456d1f075de463ac9`.
- Implementation remains working-tree changes; no implementation commit, push
  or draft PR exists.
- Release-PASS, pushed-commits and draft-PR checklist items remain unchecked.

At that review, normal workspace Git metadata write access was needed to
complete delivery from the sandbox. A [concrete PR draft](M1_PR_DRAFT.md) was
prepared but not submitted by the coordinator. The later host-shell delivery
report and its unsuccessful remote verification are recorded above.

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
