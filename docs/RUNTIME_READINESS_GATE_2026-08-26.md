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

PR `#25` merged this source as immutable `main` commit
`e1441678454c2ae0acbc47efb77d5c8a343e9ab0`. PR Verify run `32903883648`
(job `97983520892`) and post-merge Verify run `32903982765`
(job `97983816668`) both passed. These receipts prove source/CI status, not a
Railway deployment or an enabled production worker.

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

The same four responses were observed again at `2026-08-25T22:01:22Z`, after
the merge and post-merge CI had started. In particular, `/ready` remained `404`
and the marker remained `8c4c7421aef135541bc16294b017daae5515aa33`, so the
source merge did not constitute or prove a successor deployment.

## Release-identity cutover rehearsal and rollback

The owner-approved Railway account was later authenticated and the exact target
was rechecked: project `5d4cccff-ff30-43c2-9cc8-b5acec3ee428`, production
environment `8cc83d6d-1cec-446b-91a9-a547788835cb`, and service
`49d3542c-b0ca-4e85-94bd-aff815c34dc4`. Worker, webhook, webhook-secret, and
issue-action settings were all absent.

One authorized attempt set `QUIETOPS_RELEASE_COMMIT` to the same-service
reference `${{RAILWAY_GIT_COMMIT_SHA}}`. Railway accepted the variable request,
but the resolved service variable was empty. Deployment
`3fef845e-04df-4033-b917-cc72164faf08` failed before listening with the exact
runtime error `QUIETOPS_RELEASE_COMMIT must be 40 lowercase hexadecimal
characters.` The previous deployment subsequently appeared `CRASHED`, and a
bounded anonymous public probe received no response. This failed interpolation
must not be retried.

The setting was immediately restored to the exact prior value
`8c4c7421aef135541bc16294b017daae5515aa33`. Rollback deployment
`888e9a15-e847-431c-a965-f14eb23777d3`, built from main commit
`d1a2cb35844b80ff95616a7b53955b4626605355`, became the sole active `SUCCESS`
deployment. Post-rollback anonymous probes returned:

| Path | HTTP | Observation |
| --- | ---: | --- |
| `/health` | `200` | `{"status":"ok"}` and `Cache-Control: no-store` |
| `/ready` | `503` | `database: true`, `worker: false`, `migrationVersion: 2` |
| `/.well-known/quietops-release.json` | `200` | restored predecessor commit `8c4c7421aef135541bc16294b017daae5515aa33` |
| `/api/release-runs` | `200` | read-only API recovered |

The rollback restored availability, not release-identity correctness. Status is
therefore `HOLD_RELEASE_IDENTITY_CUTOVER`.

### Safe successor cutover

The Railway CLI currently permits `--skip-deploys` for variable **set**, but not
for variable **delete**, so deleting the legacy value before the code change is
not a safe no-deploy operation. The successor order is instead:

1. Keep the current valid fallback and all worker/write settings off.
2. Merge the tested runtime change that validates both inputs but treats
   Railway's own `RAILWAY_GIT_COMMIT_SHA` as authoritative when present.
3. Require the resulting deployment to be the sole active `SUCCESS` deployment,
   and require its Railway commit, public marker, and immutable main SHA to be
   identical. `/health` must be exact `200`; `/ready` must remain exact
   fail-closed `503`; legacy and release-run reads must remain `200`.
4. Only after that proof, treat deletion of the now-unused
   `QUIETOPS_RELEASE_COMMIT` as a separate deployment-triggering cleanup gate.

Stop on a missing or malformed Railway SHA, a marker/deployment/main mismatch,
any non-`200` health response, any unexpected readiness shape, more than one
active deployment, or any enabled worker/webhook/write setting. If the merge
deployment fails or public availability is lost, do not delete the fallback;
redeploy the last known-good main with the exact restored value and re-run the
four anonymous probes before any other change.

The candidate was exercised locally as a production-style process with the
restored predecessor value still configured and
`RAILWAY_GIT_COMMIT_SHA=d1a2cb35844b80ff95616a7b53955b4626605355` injected.
Startup selected the Railway value; `/health` returned `200`, the public marker
returned that Railway SHA, and `/ready` returned the expected worker-off `503`.
The temporary SQLite file was removed afterward and external mutations remained
zero.

## Gate

Status remains `HOLD_RELEASE_IDENTITY_CUTOVER`. The next deployment must be backward compatible:
worker disabled, existing `/health` check unchanged, `/ready` expected to return
`503` with `database: true`, `worker: false`, and `migrationVersion: 2`. Only a
later separately authorized worker-enable step may target `/ready` `200`.

The owner-approved Railway target is now known, but the release-identity cutover
remains a separate merge/deployment authorization. No secret installation,
webhook creation, worker enablement, incident action, or Devpost mutation is
included in that gate.
