# QuietOps Persistent Database-Path Boundary — 2026-08-22

## Outcome

Stage 4C-1d closes the local path-selection side of persistent hosting. A public QuietOps process can no longer silently reuse the repository-local demo database and present it as durable storage.

## Runtime contract

- Local loopback execution defaults to `<repository>/.quietops/quietops.sqlite` and retains explicit relative-path compatibility.
- A `0.0.0.0` bind requires `QUIETOPS_DB_PATH` to be present and absolute.
- The resolved public path must be lexically outside the resolved application repository.
- Empty and NUL-containing values are rejected.
- Validation completes before directory creation, SQLite construction, or network listening.

The lexical boundary cannot prove that the path is backed by a managed volume or defeat a deliberately introduced symlink. The later Railway configuration must select the real mount path, and live verification must confirm that the mount—not the application filesystem—owns the database.

## Verification receipt

- Focused server typecheck: passed.
- Focused server tests: 13 passed, including missing, relative, repository-local, empty, and NUL-containing path rejection plus local relative-path compatibility.
- Full repository verification: formatting, all workspace typechecks, browser syntax, and 49 tests passed (10 adapters, 10 agent, 6 application, 8 contracts, 13 server, 2 storage).
- Dependency audit: zero known vulnerabilities. Changed-byte secret-pattern scan: zero matches.
- The post-commit two-process restart probe is recorded after the local commit is created.
- External mutations: zero. No Railway volume, variable, service, build, deployment, or billing change was performed.

## Remaining Stage 4C-1 work

Stage 4C-1e subsequently added the deterministic local production-start command, and Stage 4C-1f added the local Railway build/start/health configuration. An actual managed volume and service variables remain. Creating the Railway volume and setting its mount path are external mutations and stay behind explicit approval.
