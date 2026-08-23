# QuietOps

QuietOps is a Strands-powered release identity verifier for solo developers and small software teams. It binds reviewed source, required CI, and the deployed revision into one auditable record, then refuses `Ready` when any link is missing or contradictory.

**Live read-only demo:** [quietops-production.up.railway.app](https://quietops-production.up.railway.app)

> Current boundary: the successor branch now wires the bounded GitHub and Railway collectors into one user-started, persisted Strands verification with deterministic policy and per-deployed-commit replay. This integrated path is locally verified but is not present on the public Railway deployment until successor CI, merge, deployment, and public-browser checks pass. Browser-behavior collection, live AWS/Bedrock, and AgentCore remain unverified.

## The core idea

The notification is not the innovation. The evidence chain is.

A green CI badge proves that one commit passed one workflow. It does not prove that the same commit reached production or that the running product behaves as reviewed. Small teams repeatedly reconstruct that chain from separate dashboards and notes, often while preparing to approve the release.

QuietOps makes the question explicit: **is the exact code we reviewed the code users are running?** Strands gathers bounded read-only observations; deterministic policy decides whether the required evidence is complete and aligned; the append-only ledger preserves what was observed; and a human retains authority over the exception. Observation, policy, and authorization remain separate records.

## Product flow

1. Identify one allowlisted release target by repository, branch, required workflow, and deployment marker.
2. A user starts `Verify this live release` from the public site.
3. Collect source revision, required CI result, and deployment marker through exactly three read-only Strands tools.
4. Evaluate the evidence with deterministic policy.
5. Produce a concise `Ready`, `Needs decision`, or `Could not complete` recommendation.
6. Persist provider receipts once per deployed commit and replay the same record on repeat requests.

## Planning documents

- [Project scope](docs/PROJECT_SCOPE.md)
- [Product requirements](docs/PRODUCT_REQUIREMENTS.md)
- [Technical plan](docs/TECHNICAL_PLAN.md)
- [Build and verification plan](docs/BUILD_PLAN.md)
- [Eligibility and provenance gate](docs/PROVENANCE_LEDGER.md)
- [Official event rule record](docs/EVENT_RULE_RECORD.md)
- [Current judging context](docs/JUDGING_CONTEXT_2026-08-20.md)
- [Stage 4A-2 browser product verification](docs/BROWSER_PRODUCT_SLICE_2026-08-21.md)
- [Stage 4B-0 live GitHub evidence verification](docs/LIVE_GITHUB_EVIDENCE_2026-08-22.md)
- [Stage 4B-1 live GitHub Strands/ledger verification](docs/LIVE_GITHUB_STRANDS_LEDGER_2026-08-22.md)
- [Stage 4B-2 deployment-marker collector verification](docs/DEPLOYMENT_MARKER_COLLECTOR_2026-08-22.md)
- [Stage 4B-3 interactive live-verifier verification](docs/INTERACTIVE_LIVE_VERIFIER_2026-08-23.md)
- [Hosting-target decision and external gate](docs/HOSTING_TARGET_DECISION_2026-08-22.md)
- [Stage 4C-1a public-demo decision boundary](docs/PUBLIC_DEMO_DECISION_BOUNDARY_2026-08-22.md)
- [Stage 4C-1b host, port, and health boundary](docs/HOST_PORT_HEALTH_BOUNDARY_2026-08-22.md)
- [Stage 4C-1c release-marker route boundary](docs/RELEASE_MARKER_ROUTE_2026-08-22.md)
- [Stage 4C-1d persistent database-path boundary](docs/PERSISTENT_DB_PATH_BOUNDARY_2026-08-22.md)
- [Stage 4C-1e production-start command boundary](docs/PRODUCTION_START_CONTRACT_2026-08-22.md)
- [Stage 4C-1f Railway configuration boundary](docs/RAILWAY_CONFIG_BOUNDARY_2026-08-22.md)
- [Live public demo and deployment-marker verification](docs/LIVE_PUBLIC_DEMO_2026-08-23.md)
- [Problem-selection and competition-fit rationale](docs/PROBLEM_SELECTION_RATIONALE_2026-08-22.md)
- [Submission plan](docs/SUBMISSION_PLAN.md)
- [Disclosures and claim boundaries](docs/DISCLOSURES.md)

## Current status

- Active increment: Stage 4B-3 interactive live release verifier; browser-behavior evidence, background execution, live AWS, and broader Stage 5 work remain incomplete
- Implementation: candidate identity, bounded Ready/mismatch Strands paths, a three-tool live source/CI/deployment path, deterministic policy, an append-only SQLite ledger, per-release idempotent replay, human-decision lineage for preserved mismatch cases, inbox/detail projections, and provider receipt links
- Browser and API: the guarded Fastify server defaults to loopback and exposes inbox, detail, live-verification, decision, liveness, and optionally exact-commit release-marker endpoints. A configured release identity enables the fixed-target `POST /api/live-verifications`; public mode still rejects human decision writes and exposes no arbitrary repository or URL input.
- Live integration status: the complete GitHub source → required CI → Railway marker → policy → SQLite path passes both injected tests and one actual provider-backed local browser journey. It returned `Ready` for predecessor commit `1edbded139c0e7e8ec6e90e9d8f8ee57353ea41a`, CI run `32562992913`, and the matching Railway marker, then replayed the same evaluation on the second request. The new UI and endpoint remain a local successor claim until deployed and invoked on the public domain.
- Deployment-marker validation: the construction-bound collector performed one bounded unauthenticated GET against the live Railway marker, accepted repository `YongHwan2161/quietops` and full commit `1edbded139c0e7e8ec6e90e9d8f8ee57353ea41a`, and returned `Verified` with `externalMutations: 0`.
- Hosting target: Railway is live in guarded `public-read-only` mode with one persistent volume, one replica in US West, a `/health` check, and the generated HTTPS domain `quietops-production.up.railway.app`.
- Live AWS/Bedrock validation: not performed for this repository
- Deployment: Railway deployment `e2e92c17-3c8f-4196-9517-479a2ec633e1` is active for commit `1edbded139c0e7e8ec6e90e9d8f8ee57353ea41a`; `GET /health` and the strict release marker returned HTTP `200` on 2026-08-23 KST.
- Devpost project submission: not performed from this repository

## Local verification

Requires Node.js 22 or later.

```bash
npm ci
npm run verify
npm run demo:judge
npm run demo:ledger
npm run demo:mismatch
npm run demo:github
npm run demo:github:agent
npm run demo:github:ledger
npm run demo:web
```

`npm run demo:web` binds only to `http://127.0.0.1:4173` and stores its credential-free demo ledger at `.quietops/quietops.sqlite`. A new empty ledger is seeded once through the actual Ready/mismatch Strands path; restarting the server reuses the stored projections and decisions. The browser does not import fixture JSON or write SQLite directly.

Set `QUIETOPS_DECISION_MODE=public-read-only` to exercise the fail-closed shared-demo view locally. The inbox and evidence remain visible, but the browser exposes no Reject/Re-check controls and the API returns `PUBLIC_DEMO_READ_ONLY` for otherwise valid decision writes. Omitting the setting keeps the existing `local-interactive` judge workflow.

The CLI defaults to `127.0.0.1:4173` and the repository-local `.quietops/quietops.sqlite`. A platform-style public bind additionally requires `QUIETOPS_HOST=0.0.0.0`, `PORT=<1-65535>`, `QUIETOPS_DECISION_MODE=public-read-only`, `QUIETOPS_RELEASE_COMMIT=<40 lowercase hex>`, and an absolute `QUIETOPS_DB_PATH` outside the application repository, such as `/data/quietops.sqlite`. `QUIETOPS_PORT` remains a local alias; if both port variables are set, their parsed values must match. `GET /health` is a no-store process-liveness check only. When a release commit is configured, `GET /.well-known/quietops-release.json` returns the strict repository/commit marker and enables the fixed-target live-verification endpoint. The browser cannot select another repository or deployment URL.

Production-style execution is an explicit two-command contract: run `npm run build` during the build phase, then run `npm start` to execute only the prebuilt `@quietops/server` CLI. `npm start` does not install dependencies, compile TypeScript, migrate storage, invent environment defaults for a public bind, or create a hosting resource.

`railway.json` fixes Railway's builder to Railpack, build command to `npm run build`, start command to `npm start`, and health check to `/health` with a 60-second timeout. It intentionally contains no service variables, volume mount, domain, region, scaling, or billing choice.

The judge demo runs Ready and deployed-revision mismatch scenarios through the actual Strands `Agent` loop. Each scenario calls the same three fixture-backed read-only tools exactly once. It verifies that Ready requires no human decision, while a mismatch exposes only `Reject` and `Re-check requested`; both record `externalMutations: 0`. The command exits non-zero if these invariants fail. Fixture execution is not live provider validation.

An explicit live Bedrock command is also available:

```bash
AWS_REGION=us-west-2 QUIETOPS_MODEL_ID=your-enabled-model-id npm run demo:mismatch:bedrock
```

The command uses the AWS SDK default credential chain without reading or printing credential values. It fails closed with `AWS_REGION_OR_QUIETOPS_MODEL_ID_MISSING` before model construction if either named setting is empty. Both model paths share a strict allowlist and a one-call-per-tool, three-call-total budget; deterministic policy remains authoritative. This repository has not executed or verified the live command.

The ledger and browser demos run the same credential-free Strands scenarios through one application service. They persist completed evaluation and evidence events to an append-only SQLite ledger, rank the unresolved mismatch first, record one bounded human decision, and prove that retrying the same idempotency key returns the original receipt without appending another event. A re-check creates a child evaluation linked to its preserved parent. These local paths perform zero external mutations and are not deployment or live-provider proof.

`npm run demo:github` exercises the raw adapter. `npm run demo:github:agent` runs the same shared collection through two bounded Strands tools. `npm run demo:github:ledger` also persists the exact commit, Actions run ID, source URLs, fetch time, policy outcome, and zero-mutation receipts through the application service. The live result is intentionally `Could not complete`: its candidate carries an explicit `.example.invalid` deployment placeholder and no deployment observation, so it cannot become `Ready`. These commands do not use credentials or perform an external mutation.

## Intended competition

The plan targets the Devpost **Agents for Humans Hackathon**, Professional Agents track. Competition requirements and dates can change; the official Devpost page and rules remain authoritative.

## License

This repository is licensed under the [MIT License](LICENSE).
