# QuietOps Railway Configuration Boundary — 2026-08-22

## Outcome

Stage 4C-1f adds one root `railway.json` for the already selected `PREPARE_ONLY` target. It fixes the build, start, and liveness contract without creating or changing any Railway resource.

## Configuration contract

- Schema: `https://railway.com/railway.schema.json`
- Builder: `RAILPACK`
- Build command: `npm run build`
- Start command: `npm start`
- Health-check path: `/health`
- Health-check timeout: 60 seconds

Railway's current [Config as Code reference](https://docs.railway.com/config-as-code/reference) defines these fields, and its [shared monorepo guide](https://docs.railway.com/deployments/monorepo) confirms root builds plus explicit start commands for npm workspaces.

## Intentionally absent

The file does not define variables, a volume or mount path, public networking, a domain, region, replica count, restart policy, pre-deploy mutation, or billing choice. A future authorized service must provide:

- `QUIETOPS_HOST=0.0.0.0`
- Railway-provided `PORT`
- `QUIETOPS_DECISION_MODE=public-read-only`
- `QUIETOPS_RELEASE_COMMIT=<the exact deployed full commit>`
- `QUIETOPS_DB_PATH=<an absolute path on the verified mounted volume>`

Without those values and the real volume, the current runtime fails closed and no hosted-demo claim is valid.

## Verification receipt

- Official schema: downloaded from `https://railway.com/railway.schema.json`, 8,510 bytes, SHA-256 `38d35a7de8d6fa511895abbcf9a2cac49a12494fd6a9cd2d4228a5b2a8af5e5f`.
- Schema validation: PowerShell `Test-Json` accepted `railway.json`; the temporary schema file was removed.
- Formatting: the repository Prettier check now includes `railway.json` and passed.
- Build command: `npm run build` passed for all six workspaces.
- Start command: an actual root `npm start` process used the public-mode contract and one external temporary SQLite path.
- Liveness and identity: `/health` returned exact `200`/`no-store`; the release marker returned the fixed repository and matched the configured full HEAD.
- Product read: `/api/inbox` returned two items with the `public-read-only` capability.
- Startup receipt: `externalMutations` was exactly `0`; the 40,960-byte temporary database and directory were removed after shutdown.
- Full repository verification: formatting, all workspace typechecks, browser syntax, and 49 tests passed (10 adapters, 10 agent, 6 application, 8 contracts, 13 server, 2 storage).
- Dependency audit: zero known vulnerabilities.

The process used the pre-commit HEAD as its configured marker. A final post-commit probe must use the created commit before the checkout is reported as the exact running revision.

## External mutation boundary

No Railway project, service, source connection, environment, variable, volume, domain, build, deployment, restart, or billing change is authorized or performed by this stage.
