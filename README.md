# QuietOps

QuietOps is an incrementally built release-evidence steward for solo developers and small software teams. It collects read-only release evidence, evaluates that evidence against explicit policy, and asks a human only when a genuine decision remains.

> Early implementation: the repository provides a TypeScript contract kernel, credential-free Ready/mismatch Strands agent slices, an append-only SQLite application spine, a local HTTP/browser product slice, and bounded source/CI/deployment evidence adapters. The live GitHub path runs through two Strands tools and preserves provider receipts in the ledger, but it deliberately returns `Could not complete` because no real deployment marker has been selected or observed. The deployment-marker collector is locally verified only, the browser remains fixture-backed, and no live AWS/Bedrock verification evidence exists.

## Why QuietOps

Small teams repeatedly reconstruct release readiness from commits, CI checks, deployment markers, browser behavior, and handwritten notes. QuietOps is designed to turn those scattered observations into one auditable recommendation while keeping deployment and risk acceptance under explicit human control.

## Planned product flow

1. Identify one release candidate by repository, branch, commit, and deployment URL.
2. Collect approved read-only source, CI, deployment, and browser evidence.
3. Evaluate required gates with deterministic policy.
4. Produce a concise `Ready`, `Needs decision`, or `Could not complete` recommendation.
5. Preserve evidence, recommendation, and any human decision as distinct records.

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
- [Hosting-target decision and external gate](docs/HOSTING_TARGET_DECISION_2026-08-22.md)
- [Stage 4C-1a public-demo decision boundary](docs/PUBLIC_DEMO_DECISION_BOUNDARY_2026-08-22.md)
- [Stage 4C-1b host, port, and health boundary](docs/HOST_PORT_HEALTH_BOUNDARY_2026-08-22.md)
- [Problem-selection and competition-fit rationale](docs/PROBLEM_SELECTION_RATIONALE_2026-08-22.md)
- [Submission plan](docs/SUBMISSION_PLAN.md)
- [Disclosures and claim boundaries](docs/DISCLOSURES.md)

## Current status

- Active increment: Stage 4C-1b — explicit loopback/public host and platform-port parsing plus a minimal health endpoint; the broader Stage 1, Stage 2, Stage 4, and Stage 5 plans remain incomplete
- Implementation: candidate identity, shared vocabulary, bounded Ready/mismatch Strands paths, an optional Bedrock model path for mismatch, a separate live GitHub Strands path, an append-only SQLite ledger, idempotent human decisions, re-check lineage, inbox/detail/timeline projections, and a locally verified deployment-marker collector
- Browser and API: the guarded Fastify server defaults to loopback and exposes inbox, detail, decision, and liveness endpoints to a repository-authored master-detail browser. `local-interactive` mode preserves Reject/Re-check and lineage; non-loopback binding requires `public-read-only`, which still shows evidence but removes decision controls and rejects valid decision writes with a stable `403` response.
- Live GitHub validation: two bounded Strands tools share one public source/CI collection, preserve exact provider receipts in SQLite, and return `Could not complete` with no human action because deployment evidence is missing; the browser still uses fixture scenarios
- Deployment-marker validation: a collector created with one trusted HTTPS `/.well-known/quietops-release.json` URL performs one bounded unauthenticated GET and accepts only an exact repository/full-commit schema; no real URL has been selected or called
- Hosting target: Railway is selected as `PREPARE_ONLY`; public-write, host/`PORT`, and liveness blockers are closed locally, but release-marker, persistent-volume, and production-start work remain, and no Railway resource has been created
- Live AWS/Bedrock validation: not performed for this repository
- Deployment: not performed
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

The CLI defaults to `127.0.0.1:4173`. A platform-style public bind requires all three values: `QUIETOPS_HOST=0.0.0.0`, `PORT=<1-65535>`, and `QUIETOPS_DECISION_MODE=public-read-only`. `QUIETOPS_PORT` remains a local alias; if both port variables are set, their parsed values must match. `GET /health` is a no-store process-liveness check only and does not claim ledger or provider readiness.

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
