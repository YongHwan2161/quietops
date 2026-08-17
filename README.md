# QuietOps

QuietOps is an incrementally built release-evidence steward for solo developers and small software teams. It is intended to collect read-only release evidence, evaluate that evidence against explicit policy, and ask a human only when a genuine decision remains.

> Early implementation: the repository currently provides only the TypeScript workspace and runtime-validated public contract kernel. It does not yet provide an agent, policy engine, application, deployment, or live verification evidence.

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

- Phase: Stage 1 — workspace and contracts
- Implementation: candidate identity and shared vocabulary contract kernel
- Live AWS/Bedrock validation: not performed for this repository
- Deployment: not performed
- Devpost project submission: not performed from this repository

## Local verification

Requires Node.js 22 or later.

```bash
npm ci
npm run verify
```

## Intended competition

The plan targets the Devpost **Agents for Humans Hackathon**, Professional Agents track. Competition requirements and dates can change; the official Devpost page and rules remain authoritative.

## License

This repository is licensed under the [MIT License](LICENSE).
