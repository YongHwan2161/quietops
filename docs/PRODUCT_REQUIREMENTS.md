# Product Requirements

## User promise

QuietOps handles routine release-evidence work quietly. If it interrupts the user, it explains exactly what changed, why it matters, and which decision still belongs to a human.

## Experience principles

- Quiet by default: routine success becomes a concise result, not another notification stream.
- Exception first: blocked work opens on the unresolved decision and supporting evidence.
- Facts before recommendations: observations, policy results, recommendations, and authorization are visually distinct.
- No false certainty: unknown, inaccessible, stale, or contradictory evidence remains explicit.
- Progressive detail: the outcome is understandable quickly, with evidence available on demand.
- No chat dependency: the core workflow uses an inbox, evidence views, and constrained decisions.

## Core requirements

### Release inbox

- Show repository, branch, short commit, evaluation age, outcome, and whether human attention is required.
- Rank decision-required candidates ahead of Ready candidates.
- Offer a useful credential-free demo from the empty state.

### Evaluation progress

- Show candidate identity, required checks, deployment identity, browser behavior, and policy decision.
- Support Pending, Checking, Verified, Failed, Unknown, Stale, and Not required states.
- Expose safe tool name, status, and duration telemetry without private reasoning or secrets.

### Ready result

- Bind the recommendation to the exact candidate and evaluation time.
- Link every conclusion to evidence.
- Require no human acknowledgement merely because routine checks passed.
- Avoid unsupported words such as secure, guaranteed, certified, or production safe.

### Exception handling

- Lead with one plain-language conflict and show expected and observed values together.
- Offer only actions valid for the current state.
- Keep Reject and Re-check as P0 actions; risk acceptance is deferred.
- Record actor, timestamp, action, and optional note without changing prior evidence.

### History and export

- Preserve chronological evidence, policy, recommendation, and human-decision events.
- Link a re-check to its parent evaluation without rewriting history.
- Export the candidate identity, policy version, gate results, timestamps, recommendation, decision, demo labeling, and nonclaims.

## Acceptance boundary

The P0 product is acceptable only when the Ready and mismatch journeys run end to end, duplicate actions are idempotent, stale or missing evidence fails closed, exports match screen projections, and the complete judge path performs zero external mutations.

## Implemented application and browser spine

Stage 4A-1 now provides the browser-independent state path for the credential-free demo:

- Ready and mismatch run through one application service and the existing bounded Strands agent path.
- Completed evaluation, evidence, policy, tool-call, and human-decision events are appended to SQLite.
- An unresolved mismatch is ranked ahead of Ready in the inbox projection.
- Reject and Re-check requested are the only mismatch decisions; Ready accepts neither.
- An idempotency-key replay returns the original decision receipt without creating another event.
- Re-check creates a child evaluation and preserves the parent evidence and decision timeline.

Stage 4A-2 adds the first judge-visible product path:

- A loopback-only HTTP server reconstructs inbox and detail responses from the file-backed ledger.
- The browser consumes only those HTTP projections; it does not import scenario fixtures or calculate the policy outcome.
- The initial view places an unresolved mismatch above the quiet Ready history and shows expected versus observed evidence beside zero-mutation tool receipts.
- Reject and Re-check are real API commands with required idempotency keys. Re-check opens a fresh child evaluation while both directions of the persisted lineage remain navigable after refresh or restart.

Stage 4B-0 adds the first live-provider seam without overstating product completion:

- A fixed-target, read-only GitHub adapter collects the exact public `main` revision and completed required `Verify` workflow with source receipts.
- Invalid, missing, non-allowlisted, oversized, redirected, rate-limited, or timed-out evidence fails closed.
- The adapter remains separate from the Strands runner, application service, ledger, and browser until the next integration increment; current browser evaluations therefore remain explicitly fixture-backed.

Stage 4B-1 closes the agent/application seam for source and CI only:

- Two bounded Strands tools share one live GitHub collection and persist the exact provider receipts with the observations and policy result.
- Missing deployment evidence produces `Could not complete`, no attention request, and no allowed human decision.
- The file-backed integration test proves the source/CI receipts survive ledger reopen; the live command separately proves the public GitHub → Strands → SQLite path.
- The browser remains fixture-backed, so this increment is not a fully live Ready or mismatch journey.

Stage 4B-2 establishes the deployment-observation boundary without claiming a deployment:

- Trusted application code constructs a collector around one exact HTTPS marker URL; neither the model nor a tool invocation can redirect it to another target.
- The marker must identify this repository and a full commit under a strict versioned JSON schema.
- Missing, malformed, oversized, redirected, non-HTTPS, credential-bearing, queried, fragmented, or timed-out reads fail closed.
- The collector is not yet a Strands tool and no real deployment URL has been selected, so it cannot change a live evaluation outcome.

Stage 4C-1a establishes the public-demo write boundary without claiming a hosted demo:

- `local-interactive` preserves the existing credential-free judge workflow and bounded Reject/Re-check decisions.
- `public-read-only` preserves inbox, evidence, lineage, and tool receipts but exposes no decision inputs.
- The server rejects an otherwise valid public decision request with `403 PUBLIC_DEMO_READ_ONLY`; the evaluation, timeline, and inbox identity remain unchanged.
- Missing or unrecognized browser capability data fails closed to the public read-only presentation.

Stage 4C-1b establishes the public process boundary without claiming deployment readiness:

- The local default remains `127.0.0.1:4173`; a non-loopback bind accepts only `0.0.0.0` and requires `public-read-only`.
- The standard `PORT` and local `QUIETOPS_PORT` accept only integers from 1 through 65535, and conflicting dual configuration fails closed.
- `GET /health` reports process liveness with no-store caching. It does not inspect or claim SQLite, live evidence, deployment identity, or provider readiness.

Stage 4C-1c establishes the served deployment-identity boundary without claiming a deployment:

- `QUIETOPS_RELEASE_COMMIT` accepts only one full lowercase commit and becomes mandatory before a public bind.
- The marker route is absent when the setting is absent; QuietOps cannot synthesize a deployment identity from local defaults or browser input.
- When configured, `/.well-known/quietops-release.json` returns only schema version `1`, repository `YongHwan2161/quietops`, and that exact commit under no-store headers.
- A local route response is contract proof, not proof of an HTTPS deployment, collector integration, or a `Ready` evaluation.

This slice does not satisfy the full P0 boundary by itself. Pending/checking progress, stale evidence, resumable SSE, export consistency, authentication, live deployment/browser evidence integration, background execution, and a fully live browser journey remain unimplemented.
