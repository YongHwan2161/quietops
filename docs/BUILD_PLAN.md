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

### Stage 1A — Contract kernel

- Add the reproducible npm workspace and a single `@quietops/contracts` package.
- Establish candidate identity, evidence status, evaluation outcome, and human-decision vocabulary as runtime-validated public contracts.
- Verify exact candidate serialization, full commit identity, closed vocabulary parsing, and the rule that only `Verified` is verified.
- Status: implemented and locally verified; the remainder of Stage 1 stays open.

### Stage 1B — Remote verification gate

- Run clean install and the repository verification script for every pull request and `main` push.
- Pin the runner version, Node.js version, and external actions; grant only read access to repository contents.
- Cancel superseded runs and bound each verification job to ten minutes.
- Status: implemented when the workflow passes on its own pull request; the remainder of Stage 1 stays open.

## Stage 2 — Deterministic domain and audit storage

- Implement lifecycle transitions, the exhaustive policy matrix, attention ordering, and allowed actions.
- Add SQLite migrations, append-only repositories, idempotency, redaction, and screen/export projections.
- Gate: exhaustive policy and concurrency tests prove that invalid evidence cannot produce Ready and history cannot be rewritten through public interfaces.

### Stage 2A — Append-only evaluation ledger foundation

- Add strict SQLite tables for evaluations, ordered events, and idempotency receipts without exposing update or delete operations.
- Reject update and delete statements at the database boundary and allow at most one human-decision event per evaluation.
- Preserve candidate identity, parent evaluation lineage, event sequence, payload, and timestamp.
- Status: the foundation is implemented and locally verified; the exhaustive policy matrix, concurrent writer behavior, redaction, retention, and export storage remain open.

## Stage 3 — Agent and evidence boundaries

- Integrate the pinned Strands SDK behind an `AgentRuntime` interface.
- Add only purpose-built, schema-validated tools.
- Build fresh Ready and mismatch fixture services plus bounded HTTP collectors.
- Gate: deterministic agent tests prove that tool references and policy, not narration, control state; any live Bedrock check is reported separately as LIVE PASS or HOLD.

### Stage 3A — Deployed-revision mismatch vertical slice

- Pin the Strands Agents TypeScript SDK and execute its real agent loop with three credential-free, fixture-backed read-only tools.
- Preserve source revision, CI status, and deployed revision as separately identified observations.
- Refuse `Ready` when the deployed revision differs even if model narration claims readiness, and expose only `Reject` or `Re-check requested`.
- Status: implemented when clean verification and the draft pull request check pass; live AWS/Bedrock and all external mutations remain HOLD.

### Stage 3B — Selectable Bedrock model path

- Inject a Strands `Model` into the existing mismatch slice while preserving the credential-free scripted path as the default.
- Add an explicit `BedrockModel` command that requires non-empty `AWS_REGION` and `QUIETOPS_MODEL_ID` and relies on the AWS SDK default credential chain without inspecting credential values.
- Enforce an allowlist of the three evidence tools with one call per tool and three calls total for every invocation.
- Keep the deterministic mismatch policy authoritative over model narration and keep all tools fixture-backed with zero external mutations.
- Status: implementation and credential-free verification may pass independently; live AWS/Bedrock invocation remains HOLD until separately authorized and evidenced.

### Stage 3C — Credential-free judge contrast

- Add a matching Ready fixture beside the deployed-revision mismatch fixture and run both through the same bounded Strands agent path.
- Provide one judge command that verifies scenario order, deterministic outcomes, exact tool calls, bounded human decisions, and zero external mutations.
- Fail the command closed when any judge-facing invariant changes.
- Status: implemented when Windows and Linux verification plus the draft pull request check pass; storage, UI, live AWS/Bedrock, and submission remain separate work.

## Stage 4 — Browser evidence and orchestration

- Add one isolated Playwright browser assertion path.
- Complete evaluation orchestration, bounded retries, terminal recovery, and finalization over persisted evidence IDs.
- Gate: Ready and mismatch runs execute meaningful tool sequences; timeout, injection, fabricated evidence, interruption, and narration-conflict cases fail safely.

### Stage 4A-1 — Persistent evaluation application spine

- Run the credential-free Ready and mismatch fixtures through one application service and the existing Strands runner.
- Reconstruct inbox, evaluation-detail, and timeline projections from persisted events rather than browser-owned state.
- Rank an unresolved mismatch ahead of Ready, accept only the policy-authorized decisions, and make decision commands idempotent.
- Create Re-check requested as a new child evaluation without rewriting its parent evidence or decision.
- Status: implemented and locally verified; background execution, progress events, bounded retries, recovery, API/SSE, browser collection, and browser UI remain open.

### Stage 4A-2 — Local HTTP/browser product slice

- Add a loopback-only Fastify server backed by one file-based `SQLiteEvaluationLedger` and the existing `EvaluationService`.
- Expose only inbox, evaluation detail, and idempotent decision routes; seed an empty demo ledger through the actual credential-free Strands runner rather than browser-owned fixtures.
- Render one master-detail release inbox that quietly places Ready in history, leads with an unresolved mismatch, compares expected and observed evidence, and records Reject or Re-check through the API.
- Preserve the decision receipt and parent/child evaluation lineage across refresh and server restart.
- Gate: HTTP contract, invalid-input, decision replay, restart-persistence, browser syntax, and an actual Playwright desktop journey pass with zero console errors and zero external mutations.
- Status: implemented and locally verified; SSE, background scheduling, browser evidence collection, authentication, export, live providers, deployment, and broader Stage 5 UX remain open.

### Stage 4B-0 — Bounded GitHub source/CI evidence adapter

- Add a separate adapter package that reads the exact public source revision and completed required GitHub Actions workflow for one fixed repository, branch, and workflow allowlist.
- Use only bounded unauthenticated `GET` requests to the fixed GitHub API origin; reject redirects, non-allowlisted targets, invalid or oversized payloads, missing required workflows, rate limits, and timeouts.
- Preserve the full commit, evidence URL, workflow run ID and URL, completion time, fetch time, and hard-zero external-mutation receipt.
- Keep the credential-free fixture path unchanged and do not represent the adapter as a completed live evaluation until it is registered in the Strands tools, persisted, and shown through the browser product path.
- Gate: focused success/failure tests, full repository verification, and a direct read-only observation of the current QuietOps `main` commit and `Verify` run pass.
- Status: implemented and verified locally plus one live public read on 2026-08-22 KST; Strands registration, ledger/UI integration, deployment evidence, browser evidence collection, background execution, and live AWS remain open.

### Stage 4B-1 — Live GitHub evidence through Strands and ledger

- Register exactly two live read-only tools for source revision and required CI status, backed by one shared GitHub collection so the same commit/run snapshot is reused.
- Give the live invocation a two-call allowlist and preserve provider, provider record ID, source URL, fetch time, evidence ID, and zero-mutation receipt.
- Persist the live source/CI observations, tool receipts, deterministic policy, and completion event through the existing append-only application/SQLite path.
- Represent absent deployment evidence as `Could not complete` with no human action; never synthesize a deployment observation or allow a partial evaluation to become `Ready`.
- Gate: focused agent and file-reopen ledger tests, full repository verification, and an actual public GitHub → Strands → policy → SQLite command pass.
- Status: implemented and directly verified on 2026-08-22 KST; deployment collection, browser integration, background execution, live Bedrock/AgentCore, and a fully live Ready/mismatch contrast remain open.

### Stage 4B-2 — Construction-bound deployment marker collector

- Create the read-only collector with one trusted deployment target; agent/model input cannot select or replace its URL at invocation time.
- Accept only HTTPS on the default port at `/.well-known/quietops-release.json`, without credentials, query, or fragment, and bind the marker to `YongHwan2161/quietops` plus one full lowercase commit.
- Perform one unauthenticated `GET`, reject redirects, enforce a whole-response timeout and 64-kilobyte body limit, and map missing, invalid, oversized, or interrupted evidence to stable fail-closed errors.
- Preserve the exact marker URL, fetch time, evidence ID, full deployed commit, and `externalMutations: 0` in the returned observation.
- Gate: success, unsafe-target, malformed-schema, content-type, missing, oversized, and timeout tests plus full repository verification pass.
- Status: implemented and locally verified on 2026-08-22 KST; no real deployment target has been selected or called, and Strands/application/ledger/browser integration remains open.

### Stage 4C-0 — Hosting target selection and external gate

- Compare current platform constraints against the actual monorepo, Node, SQLite, networking, persistence, and public-write requirements.
- Select Railway as `PREPARE_ONLY`: it is the shortest current path for a shared npm monorepo plus persistent SQLite volume, while AWS App Runner is closed to new customers and stateless, and Lightsail Container Service adds container/cost lifecycle work.
- Record the current local CLI state and the exact public/billable mutations that remain unauthorized.
- Refuse public deployment of the current loopback-only server because its unauthenticated decision route would let arbitrary visitors change shared judge state.
- Gate: official platform documentation, local runtime inspection, authenticated read-only CLI status, and an explicit no-resource/no-deployment boundary are recorded.
- Status: decision complete on 2026-08-22 KST; Railway project/service/volume/domain creation, repository connection, billing change, and deployment remain HOLD. Stage 4C-1 hosting-readiness code is next.

### Stage 4C-1a — Public-demo decision boundary

- Add an explicit `local-interactive` / `public-read-only` server capability; default unknown or absent browser capability data to the read-only state.
- Preserve inbox and evidence visibility in public mode while removing decision inputs and rejecting otherwise valid decision writes with a stable `403 PUBLIC_DEMO_READ_ONLY` response.
- Keep the existing local judge workflow interactive and prove that a public request cannot append a decision or timeline event.
- Gate: focused HTTP tests, TypeScript and browser syntax checks, an actual headed-browser refresh with no decision controls, zero browser console errors or warnings, full repository verification, and zero external mutations pass.
- Status: implemented and locally verified on 2026-08-22 KST; host/`PORT`, health, release marker, persistent-volume path, production start configuration, and deployment remain open.

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
