# Runtime readiness gate — 2026-08-26

## Outcome

QuietOps now has a fail-closed readiness contract for the autonomous worker
successor. `GET /health` remains liveness-only. `GET /ready` returns `200` only
when all four conditions hold in the same process:

1. `PRAGMA integrity_check` returns `ok` for the release-run SQLite ledger.
2. The applied migration version equals the supported schema version (`2`).
3. The configured release worker has started and emitted a fresh poll heartbeat.
4. The fail-closed runtime configuration passes: fixed public mode and release
   identity, external SQLite, explicit policy, signed webhook and operator
   authority, installed issue credential, live Bedrock settings, and a separately
   verified single-replica attestation.

If any condition is absent or fails, the endpoint returns `503` with only
`status`, `database`, `worker`, and `migrationVersion`. It exposes no database
path, credential, provider identity, or secret-derived value. The default
worker-disabled server therefore remains live at `/health` while correctly
reporting `worker: false` at `/ready`.

## Verification boundary

The storage test reads migration version `2` from `schema_migrations`. The worker
test proves readiness is false before start, true only after an idle poll emits a
heartbeat, and false after shutdown. Server tests prove both the default `503`
and the fully injected `200` response, plus a negative scan for path/secret/token
material.

The production CLI now wires the same worker to the real Strands Bedrock model
and construction-bound source, CI, deployment-marker, and homepage collectors.
There is no scripted fallback. The fixed-repository issue token is required to
be present before worker enable, but `QUIETOPS_GITHUB_ISSUE_ACTION_ENABLED`
defaults false. While false, the escalation choice is disabled in the browser
and rejected before decision persistence, so Item 10 cannot cause a GitHub write.

These are source and local-test claims only until CI completes on the immutable
commit. They do not prove a Railway deployment or an enabled production worker.

At `2026-08-25T21:57:20Z`, the prebuilt production CLI was also exercised as a
real local process. With the worker omitted, startup completed without any
credential value, `/health` returned `200 {"status":"ok"}`, and `/ready`
returned `503 {"status":"not-ready","database":true,"worker":false,
"migrationVersion":2}`. A second process supplied the complete non-secret
shape using placeholder credentials but deliberately removed `AWS_REGION` and
`QUIETOPS_MODEL_ID`; it exited `1` before listening with
`AWS_REGION_OR_QUIETOPS_MODEL_ID_MISSING`. No Bedrock or provider request ran.

The final local gate passed `npm run verify`: formatting, all workspace
typechecks, browser syntax, and `148` tests. `npm audit --omit=dev` reported `0`
vulnerabilities, the changed-document local-link scan reported `0` missing
targets, and `git diff --check` reported no patch errors.

## Public pre-deployment observation

At `2026-08-25T21:46:31Z` (`2026-08-26T06:46:31+09:00`), bounded anonymous GETs
against `https://quietops-production.up.railway.app` returned:

| Path | HTTP | Observation |
| --- | ---: | --- |
| `/health` | `200` | `{"status":"ok"}` |
| `/ready` | `404` | readiness contract not deployed |
| `/.well-known/quietops-release.json` | `200` | marker commit `8c4c7421aef135541bc16294b017daae5515aa33` |
| `/api/release-runs` | `200` | exception-first read API present; operator decision disabled |

The marker commit predates the current source head, so it is not valid evidence
for the successor. No Railway setting, deployment, secret, webhook, worker, or
provider resource was changed during this observation.

## Gate

Status remains `HOLD_DEPLOY`. The next deployment must be backward compatible:
worker disabled, existing `/health` check unchanged, `/ready` expected to return
`503` with `database: true`, `worker: false`, and `migrationVersion: 2`. Only a
later separately authorized worker-enable step may target `/ready` `200`.

The currently authenticated Railway CLI session resolves to a workspace the
owner previously rejected for QuietOps operations. It must not be used for any
mutation. Deployment stays blocked until the CLI is authenticated to the
owner-approved account and the exact project/service/volume are re-verified.
