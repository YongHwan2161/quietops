# QuietOps

QuietOps is an incrementally built release-evidence steward for solo developers and small software teams. It is intended to collect read-only release evidence, evaluate that evidence against explicit policy, and ask a human only when a genuine decision remains.

> Early implementation: the repository provides a TypeScript contract kernel and one Strands agent slice for a deployed-revision mismatch. The slice has a credential-free scripted path and an optional Bedrock model path, but no live AWS/Bedrock verification evidence. It does not yet provide storage, an application, or deployment.

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
- [Submission plan](docs/SUBMISSION_PLAN.md)
- [Disclosures and claim boundaries](docs/DISCLOSURES.md)

## Current status

- Active increment: Stage 3B — optional Bedrock model selection for the first agent slice; the broader Stage 1 and Stage 2 plans remain incomplete
- Implementation: candidate identity, shared vocabulary, and scripted or Bedrock-selectable deployed-SHA mismatch paths using the pinned Strands Agents SDK
- Live AWS/Bedrock validation: not performed for this repository
- Deployment: not performed
- Devpost project submission: not performed from this repository

## Local verification

Requires Node.js 22 or later.

```bash
npm ci
npm run verify
npm run demo:mismatch
```

The mismatch demo runs the actual Strands `Agent` loop with three fixture-backed read-only tools. Its scripted model intentionally narrates `Ready`; the deterministic policy still returns `Needs decision`, exposes only `Reject` and `Re-check requested`, and records `externalMutations: 0`. Fixture execution is not live provider validation.

An explicit live Bedrock command is also available:

```bash
AWS_REGION=us-west-2 QUIETOPS_MODEL_ID=your-enabled-model-id npm run demo:mismatch:bedrock
```

The command uses the AWS SDK default credential chain without reading or printing credential values. It fails closed with `AWS_REGION_OR_QUIETOPS_MODEL_ID_MISSING` before model construction if either named setting is empty. Both model paths share a strict allowlist and a one-call-per-tool, three-call-total budget; deterministic policy remains authoritative. This repository has not executed or verified the live command.

## Intended competition

The plan targets the Devpost **Agents for Humans Hackathon**, Professional Agents track. Competition requirements and dates can change; the official Devpost page and rules remain authoritative.

## License

This repository is licensed under the [MIT License](LICENSE).
