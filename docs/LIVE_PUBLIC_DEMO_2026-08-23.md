# Live Public Demo and Deployment-Marker Verification — 2026-08-23

## Outcome

`LIVE_READ_ONLY_VERIFIED` — the guarded Railway service is publicly reachable, exposes the exact release identity expected by the bounded deployment collector, and keeps shared decisions locked.

## Public target

| Item               | Verified value                               |
| ------------------ | -------------------------------------------- |
| Demo origin        | `https://quietops-production.up.railway.app` |
| Railway deployment | `e2e92c17-3c8f-4196-9517-479a2ec633e1`       |
| Repository         | `YongHwan2161/quietops`                      |
| Release commit     | `1edbded139c0e7e8ec6e90e9d8f8ee57353ea41a`   |
| Runtime mode       | `public-read-only`                           |
| Public target port | `8080`                                       |

## Verification receipts

- Chrome rendered the public decision inbox and showed `External mutations: 0` with shared decision controls removed.
- `GET /health` returned HTTP `200`, `application/json`, and exact body `{"status":"ok"}`.
- `GET /.well-known/quietops-release.json` returned HTTP `200`, `application/json`, repository `YongHwan2161/quietops`, and the full release commit above.
- The repository's own `createDeploymentRevisionCollector` called that exact allowlisted HTTPS marker and returned:
  - `kind: Deployed revision`
  - `status: Verified`
  - `evidenceId: deployment-marker:1edbded139c0e7e8ec6e90e9d8f8ee57353ea41a`
  - `externalMutations: 0`
  - `fetchedAt: 2026-08-23T04:51:50.966Z`
- Domain generation did not create a new deployment. The pre-existing Railway deployment ID remained active.

## Product-message decision

The event theme already asks agents to work quietly and surface only real decisions. That interaction pattern is therefore not a sufficient differentiator by itself.

QuietOps' differentiated claim is the identity-bound release evidence chain:

> QuietOps proves whether the exact code a team reviewed is the code users are running by binding source, CI, deployment, and browser evidence into one auditable record.

The agent gathers bounded observations. Deterministic policy refuses `Ready` when required evidence is missing, stale, failed, or contradictory. The append-only ledger preserves the observation and policy result. Human authority applies only to the unresolved exception and is recorded separately.

## Honest boundaries

- The public inbox currently shows preserved synthetic Ready/mismatch demonstration records; it is not a live evaluation of the deployed Railway commit.
- The live GitHub Strands path and the live deployment-marker collector are independently verified but are not yet composed into one agent/application/browser evaluation.
- Browser evidence collection, scheduled background execution, target-user outcome measurement, live Bedrock, and AgentCore remain incomplete.
- The public runtime proves availability, identity reporting, and read-only product behavior. It does not prove security, release correctness, or production readiness beyond the collected evidence.

## Next gate

Wire the already bounded GitHub source/CI collection and the construction-bound Railway deployment collector into one persisted live evaluation. The strict pass condition is that the candidate commit, successful required CI run, and deployed revision all resolve to the same full commit before policy can return `Ready`; missing or conflicting evidence must remain fail-closed with zero external mutations.
