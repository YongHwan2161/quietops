# Eligibility and Provenance Policy

## Purpose

This policy distinguishes newly authored QuietOps work, conceptual references, incorporated pre-existing material, and third-party dependencies so that repository history and public disclosures remain accurate.

The policy does not determine competition eligibility by itself. Current official event rules remain authoritative and must be checked again before submission.

## Decision vocabulary

- `PASS`: the reviewed item may be published within the recorded scope.
- `REFERENCE_ONLY`: concepts or lessons may inform design, but no implementation bytes are incorporated.
- `HOLD`: publication is prohibited until the named evidence or review is complete.
- `BLOCK`: the item must not be published under the current project plan.

## Current authority

| Source class                                                                                  | Current decision      | Evidence and boundary                                                                                                                            |
| --------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Planning baseline                                                                             | `PASS`                | Public repository history through commit `311238afe40b1b7d7d28c58eca40ccbd18aae892`; planning documents and MIT license only.                    |
| New QuietOps implementation authored in this repository                                       | `ELIGIBLE_FOR_REVIEW` | Git commits and diffs provide origin evidence. Each change must still pass quality, secret, dependency, and claim checks.                        |
| Stage 4A-1 evaluation ledger and application spine                                            | `ELIGIBLE_FOR_REVIEW` | Newly authored on `agent/evaluation-ledger-spine`; publication requires clean verification, diff review, and successor CI.                       |
| Stage 4A-2 local HTTP/browser product slice                                                   | `ELIGIBLE_FOR_REVIEW` | Newly authored on `agent/browser-product-slice`; publication requires clean verification, browser evidence, diff review, and successor CI.       |
| Stage 4B-0 bounded public-GitHub evidence adapter                                             | `ELIGIBLE_FOR_REVIEW` | Newly authored on `codex/stage-4b0-github-evidence`; publication requires clean verification, live-read evidence, diff review, and successor CI. |
| MortalOS, CockroachDB hackathon, and Continuum Memory Firewall                                | `REFERENCE_ONLY`      | Concepts and lessons may inform design; their implementation bytes are not represented as new QuietOps work.                                     |
| Pre-existing code, configuration, tests, fixtures, assets, or data proposed for incorporation | `HOLD`                | Requires exact source, eligibility, license, attribution, transformation, and disclosure review before publication.                              |
| Third-party packages, templates, snippets, datasets, images, APIs, and generated assets       | `HOLD`                | Requires exact version or source, license or terms review, attribution decision, and evidence of permitted use.                                  |

## Fresh implementation evidence

Newly authored QuietOps files do not require a separate import manifest. Their origin is established by the repository's reviewable branch, commit, and diff history.

Before publication, each implementation change must show:

1. a branch based on the accepted planning baseline;
2. a reviewable diff that introduces or modifies the QuietOps work;
3. no secrets, private data, or generated build output;
4. disclosed AI assistance where relevant;
5. exact versions and license decisions for newly introduced dependencies or assets;
6. tests and checks appropriate to the change;
7. no unsupported live AWS, Bedrock, AgentCore, deployment, or submission claims.

## Reference boundary

Permitted `REFERENCE_ONLY` activity includes reading and comparing earlier projects, extracting general lessons, and adapting architectural or testing ideas.

Copying or transforming implementation bytes from an earlier project is not `REFERENCE_ONLY`. It becomes incorporated pre-existing material and remains `HOLD` until the required review and disclosure are complete.

## Third-party inventory

Record each dependency or incorporated asset when it is first introduced:

| Package or asset                             | Version or source                                                               | License or terms                               | Use                                                                    | Attribution required                  | Decision                | Evidence                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                                   | `7.0.2` from npm                                                                | Apache-2.0                                     | Compiler and static type checking                                      | No separate attribution file required | `PASS`                  | Exact version in `package-lock.json`; package metadata and included license reviewed.                                                                                 |
| `@typescript/typescript-*` platform packages | `7.0.2` from npm                                                                | Apache-2.0                                     | Optional native compiler selected by operating system                  | No separate attribution file required | `PASS`                  | Exact platform package set and integrity hashes in `package-lock.json`; same TypeScript license family.                                                               |
| Prettier                                     | `3.9.6` from npm                                                                | MIT                                            | Repository format checking                                             | No separate attribution file required | `PASS`                  | Exact version in `package-lock.json`; package metadata and included license reviewed.                                                                                 |
| `@types/node`                                | `22.20.1` from npm                                                              | MIT                                            | Node.js compile-time declarations for tests                            | No separate attribution file required | `PASS`                  | Exact version in `package-lock.json`; package metadata and included license reviewed.                                                                                 |
| `undici-types`                               | `6.21.0` from npm                                                               | MIT                                            | Transitive fetch type declarations used by `@types/node`               | No separate attribution file required | `PASS`                  | Exact version and integrity hash in `package-lock.json`; package metadata and included license reviewed.                                                              |
| `actions/checkout`                           | `3d3c42e5aac5ba805825da76410c181273ba90b1` (`v7.0.1`)                           | MIT                                            | Read-only CI source checkout                                           | No separate attribution file required | `PASS`                  | Full commit SHA pinned in `verify.yml`; license reviewed at the same commit.                                                                                          |
| `actions/setup-node`                         | `820762786026740c76f36085b0efc47a31fe5020` (`v7.0.0`)                           | MIT                                            | Install the pinned CI Node.js runtime                                  | No separate attribution file required | `PASS`                  | Full commit SHA pinned in `verify.yml`; license reviewed at the same commit.                                                                                          |
| Strands Agents TypeScript SDK                | `1.13.0` from npm                                                               | Apache-2.0                                     | Execute the bounded scripted or Bedrock-selectable agent and tool loop | No separate attribution file required | `PASS`                  | Exact version and integrity hash in `package-lock.json`; npm metadata, official source, and included license reviewed. Live Bedrock verification remains `HOLD`.      |
| Zod                                          | `4.1.12` from npm                                                               | MIT                                            | Runtime validation for the three Strands tool inputs                   | No separate attribution file required | `PASS`                  | Exact version and integrity hash in `package-lock.json`; package metadata and included license reviewed.                                                              |
| Node.js built-in `node:sqlite` API           | Local Node.js `22.12.0` with version-gated flag; CI Node.js `22.22.3` unflagged | Node.js distribution terms and bundled notices | Strict SQLite ledger without a new npm database dependency             | No separate attribution file required | `PASS_RUNTIME_BUILTIN`  | Runtime versions are recorded by local verification and pinned CI; the new workspace entries add no third-party package to `package-lock.json`.                       |
| Fastify                                      | `5.12.1` from npm                                                               | MIT                                            | Loopback HTTP routing, schema validation, and request lifecycle        | No separate attribution file required | `PASS`                  | Exact version and SHA-512 integrity are in `package-lock.json`; npm metadata, source repository, included license, audit, and locked dependency tree reviewed.        |
| `@playwright/cli`                            | `0.1.18` invoked ephemerally with `npx`                                         | Apache-2.0                                     | Actual desktop browser interaction and console/screenshot verification | No repository incorporation           | `PASS_TOOL_ONLY`        | Exact version, npm integrity, source repository, and license reviewed; it is absent from `package.json` and `package-lock.json`, and generated artifacts are ignored. |
| GitHub REST API                              | Public commits and Actions workflow-runs endpoints                              | GitHub API terms and documentation             | Read the allowlisted public source revision and CI run                 | No artifact attribution required      | `PASS_PUBLIC_READ_ONLY` | Fixed API origin and target; unauthenticated GET only; no private data or mutation; official endpoint documentation recorded in the Stage 4B-0 verification note.     |

## Gate algorithm

1. Treat concepts and lessons with no copied bytes as `REFERENCE_ONLY`.
2. Treat new repository-authored work as `ELIGIBLE_FOR_REVIEW`; grant `PASS` after its change-specific checks succeed.
3. Default incorporated pre-existing bytes and new third-party material to `HOLD`.
4. Reject secrets, private data, unverifiable sources, and incompatible licenses as `BLOCK`.
5. Keep observed facts, policy results, recommendations, and human authorization distinct.
6. Invalidate a prior decision when the reviewed bytes, dependency version, license, or relevant event rule changes.

## Stage 0 exit criteria

Stage 0 is complete when this fresh-implementation policy is merged into `main`. Stage 1 may then add newly authored workspace and contract files through normal reviewed Git history.

Before that merge, planning-document updates may continue, but implementation publication remains paused.
