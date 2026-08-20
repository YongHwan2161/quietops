# Disclosures and Claim Boundaries

## Repository phase

This public repository contains planning documents, an MIT license, a TypeScript contract kernel, and newly authored credential-free Ready/mismatch Strands agent slices. The mismatch slice also includes an optional Bedrock model-selection path. Storage, application, deployment, and live-verification claims remain absent until the corresponding code and evidence are published.

## AI assistance

OpenAI Codex assisted with competition research, planning synthesis, documentation drafting, repository preparation, and may assist with later implementation. AI-assisted work will be reviewed, tested, and disclosed where relevant.

## Fresh implementation and reference boundary

- QuietOps implementation code, executable configuration, tests, fixtures, and assets will be newly authored in this repository.
- General lessons from MortalOS, the CockroachDB hackathon project, and Continuum Memory Firewall may inform design decisions, including exact artifact identity, browser evidence, immutable history, and narrow claim boundaries.
- Those earlier projects are `REFERENCE_ONLY`: their concepts and lessons may be studied, but their implementation bytes are not represented as new QuietOps work.
- If code, configuration, tests, fixtures, assets, or data from an earlier project are ever incorporated, that material must be identified explicitly and reviewed for eligibility, license, attribution, and disclosure before publication.

## Planned third-party components

The contract kernel uses TypeScript and Prettier as development tools plus the Node.js type definitions. The mismatch slice uses the Strands Agents SDK and Zod. Its Bedrock path uses `BedrockModel`, already included in the pinned Strands SDK, and the AWS SDK default credential chain; no credential values are read or printed by QuietOps. Their exact versions and licenses are recorded in the provenance ledger. React, Fastify, SQLite, Playwright, and potentially AgentCore remain anticipated only. Their versions, licenses, and actual usage will be documented only if introduced.

## Claims we may make only with evidence

- Exact source, CI, deployment, and browser observations collected in a specific evaluation.
- Deterministic policy outcome for those persisted observations.
- Test counts, checksums, digests, durations, and mutation counts from preserved receipts.
- Live AWS, Bedrock, AgentCore, hosted-demo, or Devpost status only after direct current verification.

## Claims QuietOps will not make

- That a release is secure, certified, guaranteed safe, uncompromised, or correct.
- That local fixtures prove live provider behavior.
- That an agent recommendation is human approval or production authorization.
- That absent, inaccessible, stale, or contradictory evidence passed.
