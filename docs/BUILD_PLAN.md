# Build and Verification Plan

This plan is sequenced so that each stage can fail closed and be verified before the next stage begins. No implementation is included in the initial repository.

## Stage 0 — Planning and fresh-implementation baseline

- Freeze scope, requirements, trust boundaries, submission obligations, disclosures, and outcome vocabulary.
- Record the official event rules and the distinction between fresh QuietOps implementation, conceptual references, incorporated pre-existing material, and third-party dependencies.
- Permit MortalOS, the CockroachDB hackathon project, and Continuum Memory Firewall as `REFERENCE_ONLY` design inputs without treating their implementation bytes as new QuietOps work.
- Gate: PASS when the fresh-implementation policy is merged into `main`; Stage 1 is the first implementation stage.

## Stage 1 — Workspace and contracts

- Scaffold the TypeScript workspace and strict static-quality gate.
- Define candidate, policy, evidence, event, outcome, and decision schemas.
- Gate: clean install, type checking, format checking, contract tests, dependency/license review, and secret scan pass.

## Stage 2 — Deterministic domain and audit storage

- Implement lifecycle transitions, the exhaustive policy matrix, attention ordering, and allowed actions.
- Add SQLite migrations, append-only repositories, idempotency, redaction, and screen/export projections.
- Gate: exhaustive policy and concurrency tests prove that invalid evidence cannot produce Ready and history cannot be rewritten through public interfaces.

## Stage 3 — Agent and evidence boundaries

- Integrate the pinned Strands SDK behind an `AgentRuntime` interface.
- Add only purpose-built, schema-validated tools.
- Build fresh Ready and mismatch fixture services plus bounded HTTP collectors.
- Gate: deterministic agent tests prove that tool references and policy, not narration, control state; any live Bedrock check is reported separately as LIVE PASS or HOLD.

## Stage 4 — Browser evidence and orchestration

- Add one isolated Playwright browser assertion path.
- Complete evaluation orchestration, bounded retries, terminal recovery, and finalization over persisted evidence IDs.
- Gate: Ready and mismatch runs execute meaningful tool sequences; timeout, injection, fabricated evidence, interruption, and narration-conflict cases fail safely.

## Stage 5 — API and user experience

- Add validated API routes, resumable SSE, idempotent decisions, and consistent projections.
- Build the release inbox, live evidence view, Ready packet, expected-versus-observed decision card, linked history, and Markdown export.
- Gate: component, integration, accessibility, reconnect, duplicate-action, and desktop/mobile browser journeys pass with zero console errors.

## Stage 6 — Packaging and judge verification

- Package a reproducible Docker judge path and executable Ready/mismatch demo verifier.
- Produce architecture, demo, claim-boundary, license, dependency, and verification materials.
- Gate: clean install, static checks, unit/integration/E2E tests, container health, receipt integrity, export consistency, dependency/license scan, secret scan, and hard-zero external mutation evidence pass.

## Stage 7 — Explicit external gates

Each of the following requires separate authorization and current evidence:

- publishing implementation code;
- pushing a container image;
- provisioning or changing AWS resources;
- performing live Bedrock or AgentCore validation;
- publishing a hosted demo or video;
- modifying or submitting the Devpost entry.

## Definition of done

P0 is complete only when the reproducible judge path proves both Ready and refusal-to-claim-readiness behavior, every public claim has evidence, AI and third-party use are disclosed, conceptual references are distinguished from incorporated bytes, and live actions remain clearly separated from local verification.
