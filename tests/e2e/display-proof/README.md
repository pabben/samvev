# Isolated display re-pair proof

From the repository root, run:

```sh
./tests/e2e/display-proof/run.sh
```

The script creates a uniquely named, internal network and a PostgreSQL container with a temporary filesystem under Compose project `samvev-m1`. It verifies the database container's project, service, mounts and lack of published ports, then verifies the database identity and emptiness before migration and synthetic fixture writes. It deletes only its own labelled containers and network on exit. It does not use the shared development, test or QA databases. The existing workspace dependency volume is mounted read-only by the isolated API; no dependency installation occurs.

The API reads the current worktree, and the browser container builds the current web source and serves it locally. Browser API requests are intercepted and forwarded to the isolated API. Three browser contexts exercise approval and redemption: the existing display stays authorized after approval, loses access after redemption, and the replacement receives access. The proof checks that the registration, setup and person grants remain unchanged.

The script requires the existing `samvev-m1/workspace:local` and `samvev-m1/browser:local` images, `postgres:17.11-bookworm`, and `samvev-m1-workspace-node-modules` volume. Their dependencies are not verified against the current lockfile. This is a browser simulation, not a test on a physical wall display. All fixture names, credentials and data are synthetic and test-only.
