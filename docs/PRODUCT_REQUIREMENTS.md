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

## Implemented application spine

Stage 4A-1 now provides the browser-independent state path for the credential-free demo:

- Ready and mismatch run through one application service and the existing bounded Strands agent path.
- Completed evaluation, evidence, policy, tool-call, and human-decision events are appended to SQLite.
- An unresolved mismatch is ranked ahead of Ready in the inbox projection.
- Reject and Re-check requested are the only mismatch decisions; Ready accepts neither.
- An idempotency-key replay returns the original decision receipt without creating another event.
- Re-check creates a child evaluation and preserves the parent evidence and decision timeline.

This increment does not satisfy the P0 product boundary by itself. Pending/checking progress, stale and missing evidence paths, API/SSE delivery, browser rendering, export consistency, and live-provider collection remain unimplemented.
