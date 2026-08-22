# QuietOps Production-Start Command Boundary — 2026-08-22

## Outcome

Stage 4C-1e gives a hosting platform one deterministic repository-root command: `npm start`. It delegates to `@quietops/server` and executes only the prebuilt server CLI through the existing Node SQLite version guard.

## Command contract

1. The build phase runs `npm run build`.
2. The start phase runs `npm start` from the repository root.
3. The root command delegates to the server workspace.
4. The server command executes `dist/src/cli.js`; it does not compile source, install packages, mutate hosting configuration, or weaken runtime validation.
5. Public startup still requires the explicit host, port, read-only mode, full release commit, and external absolute SQLite path defined by Stages 4C-1a through 4C-1d.

This contract does not select a Railway builder, create a service, attach a volume, set variables, or prove that a filesystem path is durable.

## Verification receipt

- Root build: `npm run build` passed for all six workspaces.
- Actual root start: `npm start` delegated to `@quietops/server` and executed `dist/src/cli.js` through `scripts/run-with-sqlite.mjs`.
- Public process: started with `0.0.0.0`, an OS-selected `PORT`, `public-read-only`, the current full HEAD, and one external temporary SQLite path.
- Liveness: `GET /health` returned `200`, exact `{ "status": "ok" }`, and `Cache-Control: no-store`.
- Release identity: `GET /.well-known/quietops-release.json` returned `200`, the fixed repository, the configured full HEAD, and `Cache-Control: no-store`.
- Product read: `GET /api/inbox` returned two items and the `public-read-only` capability.
- Startup receipt: `externalMutations` was exactly `0`; the external SQLite file was 40,960 bytes and was removed with its temporary directory after shutdown.
- Full repository verification: formatting, all workspace typechecks, browser syntax, and 49 tests passed (10 adapters, 10 agent, 6 application, 8 contracts, 13 server, 2 storage).

The process used the pre-commit HEAD as its configured marker. A final post-commit probe must use the created commit before the checkout is reported as the exact running revision.

## Remaining Stage 4C-1 work

Stage 4C-1f subsequently added the schema-bound local Railway build/start/health configuration. Required service variables and a real managed volume remain. Every Railway resource, domain, build, deployment, and billing mutation stays behind explicit approval.
