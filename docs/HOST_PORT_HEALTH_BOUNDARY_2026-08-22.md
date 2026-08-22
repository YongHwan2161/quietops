# QuietOps Host, Port, and Health Boundary — 2026-08-22

## Outcome

Stage 4C-1b closes the next two hosting-readiness blockers locally: explicit network binding and process liveness. It does not add deployment configuration or create a hosted service.

## Runtime contract

| Setting                   | Accepted values                          | Default                     | Failure boundary                                     |
| ------------------------- | ---------------------------------------- | --------------------------- | ---------------------------------------------------- |
| `QUIETOPS_HOST`           | `127.0.0.1`, `0.0.0.0`                   | `127.0.0.1`                 | Any other host is rejected before listening          |
| `PORT`                    | Integer 1-65535                          | Unset                       | Invalid values are rejected                          |
| `QUIETOPS_PORT`           | Integer 1-65535                          | `4173` when both unset      | Must resolve to the same value as `PORT` if both set |
| `QUIETOPS_DECISION_MODE`  | `local-interactive`, `public-read-only`  | `local-interactive`         | `0.0.0.0` requires `public-read-only`                |
| `QUIETOPS_RELEASE_COMMIT` | 40 lowercase hexadecimal characters      | Unset                       | Stage 4C-1c requires it for `0.0.0.0`                |
| `QUIETOPS_DB_PATH`        | Local relative/absolute; public absolute | `.quietops/quietops.sqlite` | Stage 4C-1d requires public path outside repository  |

This keeps the existing local workflow unchanged while preventing an unauthenticated interactive decision server from being exposed through the newly supported public bind.

## Health contract

`GET /health` returns HTTP `200` and exactly `{ "status": "ok" }` with `Cache-Control: no-store`. This endpoint means only that the HTTP process is responsive. It does not prove database readiness, evidence freshness, deployment identity, provider reachability, or release readiness.

## Verification receipt

- Focused server typecheck: passed.
- Focused server tests: 10 passed, including six runtime-configuration cases and the existing HTTP/application cases.
- Actual process: started with `QUIETOPS_HOST=0.0.0.0`, `PORT=4175`, and `QUIETOPS_DECISION_MODE=public-read-only`.
- Actual health response: HTTP `200`, JSON `{"status":"ok"}`, `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`.
- Actual inbox response during the same process: `public-read-only`, two seeded evaluation projections.
- Full repository verification: formatting, all workspace typechecks, browser syntax, and 46 tests passed (10 adapters, 10 agent, 6 application, 8 contracts, 10 server, 2 storage).
- Dependency audit: zero known vulnerabilities. Changed-byte secret-pattern scan: zero matches.
- The temporary Stage 4C-1b SQLite database was removed after shutdown.
- External mutations: zero. No Railway project, service, volume, variable, domain, build, deployment, restart, or billing change was performed.

## Remaining Stage 4C-1 work

Stage 4C-1c subsequently closed the local no-store release-marker contract, Stage 4C-1d added the external SQLite path requirement plus local restart proof, Stage 4C-1e added the deterministic local production-start command, and Stage 4C-1f added the local Railway build/start/health configuration. A real managed volume and service variables remain. Only after those gates pass should billing and resource creation be presented for explicit approval.
