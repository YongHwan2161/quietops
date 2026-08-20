# Technical Plan

## Planned architecture

QuietOps will use a TypeScript workspace with a React browser application, Fastify API, application services, a Strands agent boundary, purpose-built evidence adapters, deterministic policy, and SQLite audit storage.

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
- No server route, SSE stream, browser code, authentication, or live collector is implemented by this slice.

## Trust boundaries

- Tool inputs are schema validated and restricted to configured targets.
- Collectors return normalized observations, not release conclusions.
- Persisted evidence IDs and deterministic policy determine the outcome.
- Model narration may summarize but cannot override policy or fabricate evidence.
- Public URL collection will reject private, loopback, link-local, and unapproved targets.
- Browser collection will use a fresh isolated context with bounded time, redirects, and output.
- Logs, exports, and agent context will exclude credentials, authorization headers, cookies, raw pages, and private reasoning.

## Planned modules

- `contracts`: schemas and public domain types.
- `domain`: lifecycle, outcome vocabulary, attention ranking, and policy matrix.
- `storage`: migrations, append-only repositories, idempotency, redaction, and projections.
- `agent`: Strands runtime interface, bounded prompt, registered tools, and safe telemetry.
- `adapters`: fixture, HTTP, GitHub/CI, deployment, and Playwright collectors.
- `application`: evaluation orchestration, retries, finalization, recovery, and decisions.
- `server`: validated API, resumable SSE, health, readiness, and export.
- `web`: inbox, evaluation progress, Ready packet, decision card, and history.

## Planned outcome rules

- `Ready`: every required gate has fresh Verified evidence.
- `Needs decision`: evidence is contradictory or a policy-defined human boundary is reached.
- `Could not complete`: required evidence is unavailable, invalid, or collection fails safely.
- `Rejected` and `Re-check requested`: explicit human actions recorded after a non-Ready result.

Failed, Unknown, Stale, missing, foreign, fabricated, or duplicate evidence must never satisfy a required gate.

## API direction

The planned API will provide inbox, evaluation creation/detail, event replay, decisions, re-check, audit export, demo reset, health, and readiness endpoints. Mutation requests will require idempotency keys, and SSE reconnection will resume from the last persisted event.

Stage 4A-1 defines and verifies the inbox, evaluation-detail, and timeline projection shapes inside the application package. HTTP validation, status codes, authentication boundaries, SSE replay, and browser consumption remain future work.

## Deployment boundary

A local Docker judge path is P0. A hosted container or AgentCore runtime is optional and will be planned, authorized, deployed, and verified separately. Local or fixture success will not be described as live AWS/Bedrock validation.
