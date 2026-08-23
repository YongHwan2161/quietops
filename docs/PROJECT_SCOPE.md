# Project Scope

## Direction status

`REDESIGN_APPROVED_IMPLEMENTATION_HOLD` — QuietOps is being reframed from a
user-started release verifier into an autonomous release steward. This document
defines the next product boundary; it does not claim that background execution,
decision resume, or a post-decision action is implemented.

## Product statement

QuietOps watches one software release after it starts, handles routine evidence
collection and safe waiting without supervision, and contacts the release owner
only when the next valid action depends on context that the agent cannot know.
After the owner chooses, QuietOps resumes the same run and closes it with an
auditable receipt.

## Target user

A solo developer or member of a 2–10 person software team who has no dedicated
release engineer and repeatedly babysits CI, deployment progress, smoke checks,
and incident follow-up.

## Specific problem

After a release begins, the same person repeatedly switches between source,
CI, deployment, and browser surfaces to answer three questions:

1. Is the release still progressing normally?
2. Should I keep waiting, or is this now an incident?
3. Did the action I chose actually resolve or close the release?

Most checks and transient waits do not require expert attention. The real human
decision appears only when an abnormal condition persists beyond the configured
safe observation window and business context determines whether to wait longer
or escalate.

## One P0 workflow

```text
release trigger
  -> observe candidate and CI
  -> wait and re-check deployment within policy
  -> run one user-facing smoke check
  -> complete quietly when evidence converges
  -> otherwise request one bounded human decision
  -> resume from that decision
  -> verify the resulting state and close the run
```

## Genuine human decision boundary

P0 supports exactly one decision point after the normal deployment window has
expired while the previous revision is still healthy:

- `WAIT_AND_RECHECK`: the owner knows the rollout is still expected and grants
  one additional observation window.
- `ESCALATE_INCIDENT`: the owner decides the delay is no longer routine and
  authorizes QuietOps to create one evidence-backed GitHub incident issue.

QuietOps must not ask a person to reinterpret a deterministic failure. Failed
required CI, invalid evidence, an expired decision, or an action outside the
allowlist stops safely. P0 does not offer “accept the risk” or “approve the
mismatch.”

## P0 scope

- One configured repository, one release candidate source, one deployment, and
  one required workflow.
- One background or event-triggered release run that does not require opening
  the browser to advance.
- Persistent run states for observing, waiting, awaiting a decision, resuming,
  completing, escalating, and stopping.
- Bounded Strands tools for source, CI, deployment identity, browser smoke
  evidence, internal waiting, and one post-decision incident action.
- Policy-bounded waits and retries that the agent performs without human input.
- One decision envelope with facts, unresolved context, two allowed choices,
  consequences, freshness, expiry, and a resume identity.
- No external write before a valid human decision.
- At most one GitHub issue write after `ESCALATE_INCIDENT`, with an exact action
  receipt and idempotent replay.
- Append-only evidence, state-transition, decision, resume, and action records.
- A quiet completed history and an exception-first decision inbox.

## Out of scope

- Autonomous deployment, rollback, merge, secret rotation, billing, or shell
  execution.
- Risk acceptance, waiver approval, or overriding failed evidence.
- Multiple human checkpoints in one run.
- Arbitrary repository or URL input, multi-provider onboarding, or a generic
  human-in-the-loop platform.
- Multi-repository public self-service before the one-workflow P0 passes.
- Claims of security certification, production safety, or correctness beyond
  the collected evidence and executed bounded action.

## Golden-path demo

### Quiet completion

1. A release trigger starts a run without a browser action.
2. QuietOps observes successful CI, waits for deployment convergence, and runs
   the smoke check.
3. No human prompt appears.
4. The run closes with a receipt showing what QuietOps handled autonomously.

### Human checkpoint and resume

1. A second run passes CI but remains on the previous deployed revision beyond
   the normal observation window.
2. QuietOps performs every allowed wait and re-check before asking for help.
3. The owner receives one decision with current facts and the consequences of
   `WAIT_AND_RECHECK` and `ESCALATE_INCIDENT`.
4. The owner selects `ESCALATE_INCIDENT`.
5. QuietOps resumes the same run, creates one evidence-backed GitHub issue, and
   closes the run as escalated with the provider receipt.
6. Replaying the decision creates no second issue or duplicate terminal event.

## P0 success criteria

- A release run starts and progresses without the user opening QuietOps.
- The quiet path reaches a terminal result without a human prompt.
- The exception path proves at least two autonomous observations separated by a
  policy-bounded wait before a decision is created.
- The decision explains why QuietOps cannot choose and offers exactly two valid
  actions with visible consequences.
- The chosen action resumes the same persisted run after process restart.
- No external write occurs before authorization; the escalation path performs
  exactly one authorized write and preserves its provider receipt.
- Duplicate triggers, decisions, resumes, and action retries do not duplicate
  work or history.
- A reviewer can understand the problem, autonomous work, human boundary, and
  resumed outcome in the 90-second core demo.

## Existing baseline retained

The current live verifier remains valuable implementation evidence: bounded
GitHub and deployment collectors, deterministic policy, append-only SQLite,
idempotent receipts, decision lineage, a public browser, and a live Railway
deployment. It becomes an internal observation and audit subsystem of the new
workflow rather than the product's complete user journey.
