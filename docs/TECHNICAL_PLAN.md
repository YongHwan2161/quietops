# Technical Plan

## Planned architecture

QuietOps uses a TypeScript workspace with a browser application, Fastify API, application services, a Strands agent boundary, purpose-built evidence adapters, deterministic policy, and SQLite audit storage. The first browser slice uses repository-authored HTML, CSS, and JavaScript without a client framework; a later framework migration must justify its additional dependency and build surface.

```text
Browser UI
  -> Fastify API and resumable event stream
    -> Evaluation application service
      -> Strands agent with bounded tools
        -> source / checks / deployment / browser collectors
      -> deterministic policy engine
      -> append-only SQLite evidence, events, and decisions
```

No component in P0 will have deployment, merge, rollback, secret-management, or arbitrary shell authority.

## Implemented Stage 4A-1 spine

The current credential-free vertical slice implements the storage and application seam that a later browser will consume:

```text
Inbox/detail/timeline projections
  <- EvaluationService
    -> existing Ready/mismatch Strands runner
    -> deterministic policy result
    -> append-only SQLite evaluations, events, and idempotency receipts
```

- `@quietops/storage` uses the Node.js built-in `node:sqlite` API with foreign keys, strict tables, a single-decision index, and triggers that reject update or delete operations on evaluation, event, and idempotency tables.
- `@quietops/application` persists the actual agent result rather than client-authored fixture JSON, reconstructs projections from stored events, records a bounded decision once, and creates a linked child evaluation for re-check.
- A version-aware launcher enables SQLite explicitly on the local Node.js 22.12 runtime and uses the unflagged API on Node.js 22.13 or later, including the pinned CI runtime Node.js 22.22.3.
- Stage 4A-1 itself introduced no server route, SSE stream, browser code, authentication, or live collector.

## Implemented Stage 4A-2 product seam

```text
Repository-authored browser
  -> GET /api/inbox
  -> GET /api/evaluations/:evaluationId
  -> POST /api/evaluations/:evaluationId/decisions + Idempotency-Key
    -> EvaluationService
      -> file-backed append-only SQLite ledger
      -> existing bounded Ready/mismatch Strands runner for empty-demo seeding
```

- `@quietops/server` binds the demo to `127.0.0.1`, applies strict request schemas and browser security headers, maps known domain conflicts without exposing internal errors, and closes its ledger with the server lifecycle.
- An empty database is seeded once through one atomic `EvaluationService.startDemoEvaluations` batch; a non-empty database is never reset or reseeded at startup.
- The browser uses same-origin JSON only and renders dynamic evidence through DOM text nodes. It does not import fixtures, derive policy, access SQLite, or retain the authoritative decision only in client state.

### Stage 4C-1a public-demo mode

The server is constructed with one explicit decision mode. `local-interactive` is the CLI default for the existing loopback judge workflow. `public-read-only` adds its capability to the inbox projection, returns `403 PUBLIC_DEMO_READ_ONLY` before invoking the application decision service, and leaves all read projections available.

The browser initializes fail-closed to the public state and unlocks decision inputs only when the server explicitly reports `local-interactive`. Public mode renders the unresolved human-decision reason as a product boundary rather than a disabled form. This is anonymous evidence viewing, not authentication or a shared interactive workflow.

- Re-check returns the persisted receipt plus its child projection. Inbox reload and process restart reconstruct the same parent/child history from SQLite.
- Static HTML/CSS/JavaScript keeps this slice build-light. Fastify is the only new direct locked runtime dependency; Playwright CLI is an external local verification tool rather than an application dependency.

## Trust boundaries

- Tool inputs are schema validated and restricted to configured targets.
- Collectors return normalized observations, not release conclusions.
- Persisted evidence IDs and deterministic policy determine the outcome.
- Model narration may summarize but cannot override policy or fabricate evidence.
- Public URL collection will reject private, loopback, link-local, and unapproved targets.
- Browser collection will use a fresh isolated context with bounded time, redirects, and output.
- Logs, exports, and agent context will exclude credentials, authorization headers, cookies, raw pages, and private reasoning.

## Implemented Stage 4B-0 provider seam

The first live-provider boundary is isolated in `@quietops/adapters`. It accepts only the exact `YongHwan2161/quietops`, `main`, and `Verify` target, constructs requests under the fixed `https://api.github.com` origin, and performs one commit lookup followed by one completed workflow-run lookup. Redirects are rejected; each request has a bounded timeout; responses are size-limited and schema-validated; missing or malformed evidence fails closed.

The adapter emits source and CI observations with stable evidence IDs, source URLs, fetch time, run identity, and `externalMutations: 0`. At the Stage 4B-0 checkpoint it deliberately remained outside the Strands tool registry, application service, ledger, and browser projections. That separation made the adapter independently verifiable without implying that the end-to-end product already used live evidence; the Stage 4B-1 successor below closes the agent/application/ledger part of that gap.

## Implemented Stage 4B-1 live agent/ledger seam

Stage 4B-1 registers the source and CI adapter behind exactly two Strands tools. Both tools share one lazy collection promise, so one commit request and one workflow-runs request produce a bound source/CI snapshot rather than two independently drifting reads. A scenario-specific two-call `EvidenceToolBudget` rejects duplicate or foreign tool use.

The application persists both observations and their GitHub provider receipts through the existing append-only SQLite event path. At the Stage 4B-1 checkpoint no deployment collector existed, so deterministic policy recorded `Could not complete`, no human decision was offered, and the placeholder deployment URL used the reserved `.example.invalid` domain. The live scenario remains separate from browser demo seeding and cannot silently replace the credential-free judge contrast.

## Implemented Stage 4B-2 deployment marker boundary

The deployment collector is a factory whose trusted construction input binds one exact HTTPS URL ending in `/.well-known/quietops-release.json`. The returned zero-argument collector gives the agent no target-selection surface. It rejects credentials, non-default ports, query strings, fragments, alternate paths, redirects, non-JSON content, unknown marker fields, repository drift, abbreviated commits, oversized bodies, missing resources, and timeouts.

The accepted marker schema is exactly `{ schemaVersion: "1", repository: "YongHwan2161/quietops", commit: <40 lowercase hex> }`. A successful read returns a `Verified` deployed-revision observation with its full commit, exact marker URL, fetch time, stable evidence ID, and zero external mutations. This is local contract proof only: a real target, Strands tool registration, application/ledger persistence, and browser projection remain successor work.

## Planned modules

- `contracts`: schemas and public domain types.
- `domain`: lifecycle, outcome vocabulary, attention ranking, and policy matrix.
- `storage`: migrations, append-only repositories, idempotency, redaction, and projections.
- `agent`: Strands runtime interface, bounded prompt, registered tools, and safe telemetry.
- `adapters`: bounded public-GitHub source/CI and construction-bound deployment-marker collectors are implemented; a real marker target, Playwright collector, and deployment-marker Strands/application integration remain planned.
- `application`: evaluation orchestration, retries, finalization, recovery, and decisions.
- `server`: validated API, resumable SSE, health, readiness, and export.
- `web`: the current static master-detail inbox and decision card; evaluation progress, Ready packet, richer history, and export remain planned.

## Planned outcome rules

- `Ready`: every required gate has fresh Verified evidence.
- `Needs decision`: evidence is contradictory or a policy-defined human boundary is reached.
- `Could not complete`: required evidence is unavailable, invalid, or collection fails safely.
- `Rejected` and `Re-check requested`: explicit human actions recorded after a non-Ready result.

Failed, Unknown, Stale, missing, foreign, fabricated, or duplicate evidence must never satisfy a required gate.

## API direction

The broader planned API will provide evaluation creation, event replay, audit export, health, readiness, and resumable event delivery. Mutation requests will require idempotency keys, and any later SSE reconnection will resume from the last persisted event.

Stage 4A-2 implements the first three HTTP routes: inbox, evaluation detail, and decisions. Stage 4C-1a adds the explicit local-interactive/public-read-only capability without adding a route. The slices verify HTTP validation, status/error mapping, duplicate-action replay, public write rejection, browser consumption, and restart persistence. Authentication, creation routes, SSE replay, export, health/readiness, and any destructive demo reset remain future work.

## Deployment boundary

A local Docker judge path is P0. A hosted container or AgentCore runtime is optional and will be planned, authorized, deployed, and verified separately. Local or fixture success will not be described as live AWS/Bedrock validation.
