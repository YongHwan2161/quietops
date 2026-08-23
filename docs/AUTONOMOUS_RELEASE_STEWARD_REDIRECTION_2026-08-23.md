# Autonomous Release Steward Redirection

## Decision

`CHECKLIST_READY_BUILD_HOLD`

This is a documentation-only product decision. It does not authorize a provider
write, deployment, public receipt replacement, or a claim that the redesigned
workflow is implemented.

## Why the direction changed

The existing verifier proves several strong engineering properties, but its
primary interaction is still “open a browser, click Verify, inspect a report.”
That is useful infrastructure, not yet a convincing demonstration of an agent
that works independently and involves a person at the exact moment their
judgment becomes necessary.

The product now has to prove all three parts of one continuous job:

1. autonomous progress without an open browser,
2. a decision the agent genuinely cannot make from available evidence, and
3. resumption that carries the decision into one bounded, verified outcome.

## One-sentence problem

Small-team release owners waste attention repeatedly checking CI, deployment,
and smoke status even though most observations and short waits do not require
their judgment.

## One-sentence product

QuietOps watches one release for them, finishes normal observation quietly, and
asks only whether a persistently delayed but still-healthy rollout should receive
more time or become an incident—then it performs that choice once and proves it.

## 90-second core demo

| Time   | Evidence shown                                                                          | Claim earned                                    |
| ------ | --------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 0–10s  | Release owner switching among CI, deployment, and smoke status                          | The recurring attention problem is concrete     |
| 10–20s | A release event starts a QuietOps run with no dashboard click                           | The agent is event-driven, not a manual report  |
| 20–35s | Strands invokes bounded source, CI, deployment, wait, re-check, and smoke tools         | QuietOps performs multi-step autonomous work    |
| 35–43s | Normal run closes with `human prompts: 0` and `external writes: 0`                      | Routine releases finish quietly                 |
| 43–58s | Delayed run stays healthy; QuietOps waits and re-checks until the normal budget expires | The agent exhausts safe work before escalating  |
| 58–70s | One decision shows facts, unresolved context, and two consequences                      | The human boundary is genuine and specific      |
| 70–78s | Owner selects `ESCALATE_INCIDENT`                                                       | Human context supplies the missing intent       |
| 78–87s | The same run resumes and creates one evidence-backed GitHub issue                       | The decision changes real bounded work          |
| 87–90s | Terminal receipt shows one authorization, one provider write, and no duplicate          | The resumed outcome is auditable and idempotent |

## Decision contract

| Field             | P0 requirement                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Preconditions     | Required CI succeeded; candidate is not deployed; previous revision remains healthy; normal observation budget expired |
| Missing context   | Whether this rollout is still expected by the owner or should now be treated as an incident                            |
| Choice A          | `WAIT_AND_RECHECK` — grant one additional bounded observation window                                                   |
| Choice B          | `ESCALATE_INCIDENT` — authorize one evidence-backed GitHub issue                                                       |
| Forbidden choices | Accept risk, approve mismatch, ignore failed CI, override unhealthy deployment, free-form command                      |
| Freshness         | Decision carries evidence timestamps and expires                                                                       |
| Resume identity   | Decision is bound to one run, candidate, state version, and idempotency key                                            |
| Write boundary    | Zero provider writes before the decision; at most one issue write after escalation authorization                       |

## Implementation gates

### Gate A — Real autonomy

- A non-browser event can start the run.
- At least one real wait and re-check occurs in the delayed path.
- Waiting is persisted, and restart resumes rather than recreates the run.
- The happy path reaches a terminal result without user input.
- Strands selects and sequences bounded tools inside deterministic policy guards;
  it is not a one-shot wrapper around a precomputed report.

### Gate B — Genuine decision

- Either option can be correct depending on information outside the observed
  systems.
- The question appears only after the full safe observation budget is exhausted.
- The user can decide from the displayed facts and consequences.
- Failed CI, unhealthy deployment, invalid evidence, and missing evidence never
  become approval requests.

### Gate C — Resume is not theater

- The decision resumes the same durable run.
- `WAIT_AND_RECHECK` performs a new bounded observation.
- `ESCALATE_INCIDENT` creates one real issue and stores the provider receipt.
- Duplicate answers, retries, and restart do not duplicate the issue or terminal
  history.

### Gate D — Effect accounting

- Pre-decision provider writes: exactly zero.
- Wait branch provider writes: exactly zero.
- Escalation branch provider writes: exactly one authorized issue.
- An ambiguous write result is preserved and not blindly retried.
- Observation, decision, authorization, action, and terminal events remain
  distinct.

### Gate E — Competition communication

- The product can be explained as one problem, one user, and one outcome in a
  sentence.
- The complete autonomy-decision-resume arc fits in 90 seconds.
- Strands orchestration is visible without making architecture the opening
  story.
- Live URL, repository, demo video, architecture diagram, and receipts can be
  produced without claiming an unimplemented behavior.

## HOLD conditions

Stop and redesign if any implementation proposal:

- requires clicking Verify to begin the showcased run,
- asks the user merely to acknowledge a mismatch,
- cannot resume the same run after a process restart,
- turns the chosen action into another report with no bounded effect,
- grants broad write authority or permits an arbitrary command,
- risks another project, repository, or competition entry, or
- must lead with ledger, SHA, CI, or policy terminology before the user problem
  makes sense.

## Deliberate scope cuts

- One repository and release workflow before multi-repository onboarding.
- One checkpoint before a generic decision engine.
- One reversible, low-blast-radius action before deployment or rollback writes.
- One user-facing smoke route before arbitrary browser automation.

## Existing assets to reuse

- GitHub and deployment evidence collectors.
- Deployment marker and user-facing smoke route.
- Bounded Strands tool budget and deterministic policy.
- Append-only SQLite events, receipts, idempotency, and decision lineage.
- Fastify service, browser surface, Railway deployment, and existing CI.

These assets reduce implementation risk. They do not waive Gates A–E.

## Evidence required before calling the redesign implemented

- Quiet completion receipt from a non-browser-triggered run.
- Delayed-run trace with at least two observations and a real wait.
- Fresh decision envelope with both consequences.
- Restart-resume trace for the same run.
- One authorized GitHub issue receipt and duplicate-replay proof.
- Hard-zero pre-decision mutation evidence.
- 90-second recording that shows the user problem before internals.

## Next gate

The [technical specification](AUTONOMOUS_RELEASE_STEWARD_TECHNICAL_SPEC_2026-08-23.md)
maps this contract to the current codebase and passes Gates A–E on paper. The
[sequenced build checklist](AUTONOMOUS_RELEASE_STEWARD_BUILD_CHECKLIST_2026-08-23.md)
now supplies independent pass, stop, evidence, and rollback conditions for 12
items. Implementation remains on HOLD until the checklist is reviewed and the
user explicitly starts Item 1.
