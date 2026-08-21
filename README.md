# QuietOps

QuietOps is an incrementally built release-evidence steward for solo developers and small software teams. It collects read-only release evidence, evaluates that evidence against explicit policy, and asks a human only when a genuine decision remains.

> Early implementation: the repository provides a TypeScript contract kernel, credential-free Ready/mismatch Strands agent slices, an append-only SQLite application spine, and a local HTTP/browser product slice. The mismatch slice also has an optional Bedrock model path, but no live AWS/Bedrock verification evidence. The browser is a credential-free judge path, not a deployed service or live-provider claim.

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
- [Submission plan](docs/SUBMISSION_PLAN.md)
- [Disclosures and claim boundaries](docs/DISCLOSURES.md)

## Current status

- Active increment: Stage 4A-2 — local HTTP/browser product slice; the broader Stage 1, Stage 2, Stage 4, and Stage 5 plans remain incomplete
- Implementation: candidate identity, shared vocabulary, bounded Ready/mismatch Strands paths, an optional Bedrock model path for mismatch, an append-only SQLite ledger, idempotent human decisions, re-check lineage, and inbox/detail/timeline projections
- Browser and API: a loopback-only Fastify server exposes three validated endpoints to a repository-authored master-detail browser. The UI reads only server projections, surfaces mismatch before Ready, records Reject/Re-check through the API, and shows persisted parent/child lineage.
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
npm run demo:web
```

`npm run demo:web` binds only to `http://127.0.0.1:4173` and stores its credential-free demo ledger at `.quietops/quietops.sqlite`. A new empty ledger is seeded once through the actual Ready/mismatch Strands path; restarting the server reuses the stored projections and decisions. The browser does not import fixture JSON or write SQLite directly.

The judge demo runs Ready and deployed-revision mismatch scenarios through the actual Strands `Agent` loop. Each scenario calls the same three fixture-backed read-only tools exactly once. It verifies that Ready requires no human decision, while a mismatch exposes only `Reject` and `Re-check requested`; both record `externalMutations: 0`. The command exits non-zero if these invariants fail. Fixture execution is not live provider validation.

An explicit live Bedrock command is also available:

```bash
AWS_REGION=us-west-2 QUIETOPS_MODEL_ID=your-enabled-model-id npm run demo:mismatch:bedrock
```

The command uses the AWS SDK default credential chain without reading or printing credential values. It fails closed with `AWS_REGION_OR_QUIETOPS_MODEL_ID_MISSING` before model construction if either named setting is empty. Both model paths share a strict allowlist and a one-call-per-tool, three-call-total budget; deterministic policy remains authoritative. This repository has not executed or verified the live command.

The ledger and browser demos run the same credential-free Strands scenarios through one application service. They persist completed evaluation and evidence events to an append-only SQLite ledger, rank the unresolved mismatch first, record one bounded human decision, and prove that retrying the same idempotency key returns the original receipt without appending another event. A re-check creates a child evaluation linked to its preserved parent. These local paths perform zero external mutations and are not deployment or live-provider proof.

## Intended competition

The plan targets the Devpost **Agents for Humans Hackathon**, Professional Agents track. Competition requirements and dates can change; the official Devpost page and rules remain authoritative.

## License

This repository is licensed under the [MIT License](LICENSE).
