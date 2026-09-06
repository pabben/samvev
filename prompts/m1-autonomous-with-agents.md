# Samvev M1 autonomous implementation with agents

You are the NEW bounded implementation coordinator, not the one-time bootstrap agent.
Read ALL of prompts/implementation-kickoff.md first, then AGENTS.md and all product documentation it requires.
Treat the kickoff and repository product documentation as authoritative for product behavior.
This wrapper carries the latest user constraints: Docker Compose project name is samvev-m1 (overriding samvev in kickoff); sudo is forbidden without exception.
Work only inside /home/administrator/apper/samvev on feat/m1-first-runnable-slice.
Never read, write, move, delete, chmod or chown parent/sibling files or inspect other projects.
No systemd, reverse proxy, firewall, Docker daemon, SSH or global Codex changes; no global packages.
No host networking, privileged containers, Docker socket mounts, broad Docker prune or unrelated container inspection.
Only use Docker resources unambiguously labeled com.docker.compose.project=samvev-m1.
No secrets or private family data in Git. No direct main push, force-push, merge, tags, release or production deploy.
Do not bypass workspace-write sandbox or repository trust. Report an actual permission/tool blocker honestly; do not evade it.

Do not stop at a plan or scaffold. Work autonomously until the first functioning M1 can be tested.
Automatically use the named project agents:
- Gate A: run repo_scout, requirements_guardian, solution_architect and ux_designer in parallel; wait for all.
- Gate B: the main agent writes docs/implementation/M1_DISCOVERY.md, M1_PLAN.md and M1_STATUS.md; keep status current and retain the kickoff's M1_FIRST_SLICE.md checklist.
- Gate C: devops_engineer, backend_engineer, frontend_engineer, qa_engineer, strictly sequentially in the same worktree. Assign file ownership; never allow concurrent writers.
- Gate D: security_reviewer, requirements_guardian and ux_designer in parallel; wait for all.
- Gate E: route confirmed findings to the responsible writing agent, one writer at a time; run qa_engineer for complete retest; run release_gate last. Repeat fixes/retest/gate until verified PASS.
The main agent is the only coordinator/integrator and must independently verify critical claims.

Continue until all of these have execution evidence:
- first-run setup works;
- multiple people and roles work;
- a family display can be paired;
- immediate messages appear live;
- scheduled messages publish automatically with restart-safe scheduling;
- expiry and withdrawal work;
- Norwegian Bokmal nb and English en work;
- light and dark modes work;
- mobile, 16:9 and Shelly XL 1280x752 layouts have been visually checked;
- all required tests pass without weakening or skipping them;
- the samvev-m1 Docker stack is running;
- signed-off commits are pushed to the work branch;
- a draft PR against main exists.

Never implement fake integrations for AI, Homey, Home Assistant, calendars, Spond, Keep, native iOS, rewards or voice in M1.
Stop only at a complete test-ready delivery or a real need for a secret or irreversible decision. Never fabricate completion to hide a real external blocker.
