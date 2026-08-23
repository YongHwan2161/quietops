# Product Requirements

## Status

`REDESIGN_APPROVED_IMPLEMENTATION_HOLD` — This PRD describes the intended P0
product. The existing verifier is an implementation baseline, not evidence that
the workflow below already exists. Implementation may begin only after the
redirection gates are translated into a technical specification.

## Product summary

QuietOps is an autonomous release steward for a small software team. It follows
one release in the background, completes routine observation and bounded waiting
on its own, and asks for one human decision only when the evidence cannot reveal
whether a prolonged rollout is expected or should be treated as an incident.
It then resumes the same run and records the authorized result.

## Target user

A solo developer or member of a 2–10 person team who owns releases but does not
have a dedicated release engineer.

## User promise

“Start the release, leave QuietOps alone, and hear from it only if your context
is required. When you decide, it carries that decision through once and proves
what happened.”

## Product vocabulary

### Run states

- `MONITORING`: collecting current release evidence.
- `WAITING`: sleeping until a policy-defined observation time.
- `AWAITING_DECISION`: all safe autonomous work is exhausted and one fresh
  human decision is required.
- `RESUMING`: applying one valid decision to the same persisted run.
- `COMPLETED`: release evidence converged without human help.
- `ESCALATED`: one authorized incident issue was created and verified.
- `STOPPED`: deterministic failure, invalid evidence, expired authority, or an
  unavailable required surface prevents safe progress.

### Evidence outcomes

- `VERIFIED`: the required claim is supported by current evidence.
- `BLOCKED`: current evidence contradicts a required condition.
- `UNAVAILABLE`: the required evidence could not be obtained or validated.

`AWAITING_DECISION` is not a softer name for `BLOCKED` or `UNAVAILABLE`. It is
valid only when the evidence is sufficient and the remaining choice depends on
human context.

## Core user journey

1. A configured release event creates a durable run without a browser click.
2. QuietOps observes the release candidate and required CI.
3. If CI succeeds, QuietOps observes deployment identity.
4. If the candidate is not live but the previous revision is healthy, QuietOps
   waits and re-checks within a configured budget.
5. If the candidate converges, QuietOps performs one user-facing smoke check and
   completes quietly.
6. If the normal observation budget expires while the previous revision remains
   healthy, QuietOps creates one decision envelope.
7. The owner chooses `WAIT_AND_RECHECK` or `ESCALATE_INCIDENT`.
8. QuietOps resumes the same run, performs the chosen bounded action, and
   verifies its outcome.
9. The history shows autonomous work, human attention, external writes, and the
   terminal receipt separately.

## Epic 1 — Leave the release watch loop

### User story

As a release owner, I want QuietOps to start from a release event and continue
without an open tab so that I do not babysit the dashboard.

### Acceptance criteria

- One configured trigger creates exactly one release run.
- Closing and reopening the browser does not pause, restart, or duplicate work.
- A duplicate trigger resolves to the existing run and receipt.
- The first screen prioritizes the current release and whether attention is
  required, not an evidence ledger.
- A normal release completes with zero human prompts.

## Epic 2 — Make safe autonomous progress

### User story

As a release owner, I want the agent to collect evidence and absorb ordinary
rollout delay before contacting me.

### Acceptance criteria

- Every tool call records its bounded purpose, input identity, time, outcome,
  and receipt.
- Deterministic policy bounds the allowed tools, observation count, wait length,
  total run time, and terminal states.
- The delayed-deployment path performs at least two deployment observations
  separated by a real policy-controlled wait.
- `WAITING` is persisted before sleep and survives process restart.
- Failed required CI, unhealthy deployment, invalid evidence, or unavailable
  required evidence reaches `STOPPED`; none creates an approval request.
- The quiet-completion path performs zero external writes.

## Epic 3 — Ask one question only a person can answer

### User story

As a release owner, I want a concise decision only after the agent has exhausted
safe work, with enough context to choose without reopening every tool.

### Acceptance criteria

- A decision is valid only when required CI succeeded, the previous deployment
  remains healthy, the candidate is still absent, and the normal observation
  budget is exhausted.
- The decision includes the exact run and candidate, current facts, observations
  already attempted, why the agent cannot choose, two options, each consequence,
  evidence freshness, expiry, and a resume/idempotency identity.
- The only P0 options are `WAIT_AND_RECHECK` and `ESCALATE_INCIDENT`.
- There is no free-form command, “accept risk,” “approve mismatch,” or silent
  default.
- Expired, stale, already-consumed, or foreign-run decisions are rejected.

## Epic 4 — Resume and carry out the decision once

### User story

As a release owner, I want my decision to continue the paused work rather than
merely acknowledge a warning.

### Acceptance criteria

- A valid choice resumes the original run; it does not create an unrelated run.
- `WAIT_AND_RECHECK` grants one additional bounded observation window and then
  re-enters the deterministic state machine.
- `ESCALATE_INCIDENT` authorizes exactly one GitHub issue containing current
  evidence and a stable QuietOps run reference.
- No provider write occurs before the authorization is durably recorded.
- Repeated decision submissions, process restarts, and action retries do not
  create a second issue or terminal event.
- If the provider outcome is ambiguous, QuietOps records uncertainty and does
  not blindly retry the write.
- Evidence observations, human authorization, action attempts, provider
  receipts, and terminal state transitions remain distinct records.

## Epic 5 — Make saved attention visible

### User story

As a judge or user, I want to see what the agent handled and exactly where human
judgment changed the outcome.

### Acceptance criteria

- Each run reports counts for autonomous observations, policy waits, human
  prompts, and external writes.
- The normal path visibly reports `human prompts: 0`.
- Timing and counts come from run records rather than marketing estimates.
- Preserved demo evidence and current live evidence are labeled separately.
- A first-time viewer can identify the user, recurring problem, autonomous work,
  genuine human boundary, and resumed result without reading implementation
  details.

## Edge cases

- Duplicate release event arrives before or after a terminal state.
- Process stops during observation, persisted waiting, or resume.
- Candidate changes while a run is active.
- CI status changes or becomes stale during the observation window.
- Previous deployment becomes unhealthy while waiting.
- Candidate deploys after a decision is created but before it is answered.
- Decision expires, is submitted twice, or targets a different run.
- GitHub issue creation times out after the provider may have accepted it.
- Smoke evidence is unavailable after deployment convergence.
- Provider rate limits or credentials prevent a required read or authorized
  write.

## What we are building now

1. A technical specification for the persistent release-run state machine.
2. A non-browser trigger and resumable background runner.
3. A bounded autonomous observe/wait/smoke sequence using the existing
   collectors and Strands integration.
4. The single decision envelope and two resume branches.
5. Exactly-once incident escalation with provider receipt.
6. An exception-first browser experience and a deterministic 90-second demo.

## What may be added later

- Installation for arbitrary public repositories.
- Multiple deployment providers and workflow mappings.
- Team roles, multiple responders, and notification channels.
- Additional reversible actions proven by separate policy and idempotency
  contracts.

These are expansion paths, not P0 requirements. Repository generality is useful
only after the one configured workflow proves the full autonomy-decision-resume
loop.

## Non-goals

- A read-only report generator presented as the entire product.
- A generic approval inbox or human-in-the-loop SDK.
- A chatbot that asks what to do before exhausting bounded autonomous work.
- Autonomous production mutation beyond the single authorized incident issue.
- Optimizing for broad integration count before proving one complete outcome.

## Submission proof points

- One unassisted quiet-completion run.
- One delayed-rollout run with autonomous wait, a genuine decision, and resume.
- One process-restart recovery during a non-terminal state.
- Zero writes before authorization and exactly one issue after escalation.
- Duplicate-trigger and duplicate-decision evidence.
- Visible Strands orchestration plus deterministic policy enforcement.
- A live URL and a 90-second core story understandable without repository
  archaeology.

## Implementation entry gate

The implementation must satisfy the gates in
[Autonomous Release Steward redirection](AUTONOMOUS_RELEASE_STEWARD_REDIRECTION_2026-08-23.md).
If a proposed shortcut violates a gate or HOLD condition, the design returns to
review rather than being presented as a completed feature.
