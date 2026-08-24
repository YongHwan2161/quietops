# Autonomous Release Steward Build Checklist

## Status

`ITEM_4_COMPLETE_ITEM_5_HOLD`

This checklist is the implementation contract for the
[technical specification](AUTONOMOUS_RELEASE_STEWARD_TECHNICAL_SPEC_2026-08-23.md).
It authorizes no code change, credential installation, webhook creation, provider
write, merge, deployment, or Devpost submission. Item 1 may begin only after this
documentation PR is reviewed and the user explicitly advances to the build.

## Build preferences

- **Plan owner:** Codex prepares and maintains the sequence; the user can redirect
  it between items.
- **Build mode:** Step-by-step. One checklist item is the maximum scope of one
  implementation turn, and this locks when Item 1 begins.
- **Comprehension checks:** No separate tutorial pauses; reports explain design
  choices and exact evidence at the user's technical level.
- **Git:** One green commit per item on a fresh implementation branch based on the
  then-current `origin/main`. Never mix unrelated changes or merge automatically.
- **Verification:** Stop after every item with focused tests, full relevant CI,
  mutation counts, and a clean-worktree receipt.
- **Check-in cadence:** Evidence-driven, one item per user instruction.
- **Timebox:** Items 1–9 target 15–30 minutes each. If an item cannot reach its
  pass gate in that window, stop with the smallest verified subset instead of
  silently widening scope. Item 10 is intentionally a group of external gates;
  each authorization boundary is a separate turn and mutation.
- **Rollback:** Before external integration, revert only the item's commit. For
  Items 10–11, disable the worker first, then deactivate the exact webhook/revoke
  the exact issue credential, and roll back only the named deployment if
  authorized.
- **Wow moment:** A release starts with no browser click, QuietOps absorbs the
  routine wait, asks one context-dependent question, resumes the same run, and
  closes with one bounded effect receipt.

## Global gates

- The existing verifier, public read-only routes, database, and release marker
  must remain backward compatible until their replacements pass.
- New runtime behavior defaults off. Local construction and tests must not require
  AWS, Railway, GitHub secrets, or a network write.
- No item may accept an arbitrary repository, URL, tool, issue body, or command
  from the browser or model.
- Failed CI, unhealthy smoke, missing evidence, stale authority, or invalid state
  must reach `STOPPED`, never a human approval.
- Every provider receipt records the bounded target, provider identity, fetch or
  action time, result, and effect count without credentials or raw headers.
- An item is not complete while its focused tests, `npm run verify`, or GitHub CI
  are red. Failed evidence is preserved; do not relabel or backfill it as PASS.
- Implementation, merge, deployment, credential installation, webhook creation,
  the first live issue, and Devpost submission are separate authorization gates.

## Checklist

- [x] **1. Add the release-run contracts and deterministic transition kernel**
      Spec ref: `Autonomous Release Steward Technical Spec > State machine` and
      `> Policy profile`
      What to build: Add the closed run-state, decision-envelope, external-action,
      policy-profile, stop-code, and public-projection contracts. Add a pure
      transition function covering every allowed and forbidden state change without
      changing the legacy verifier vocabulary.
      Acceptance: All seven run states and both choices parse strictly; unknown keys
      fail closed; failed CI, unhealthy smoke, unavailable evidence, stale decisions,
      and extension exhaustion can never emit a decision or action plan.
      Verify: `npm test --workspace @quietops/contracts` and focused table tests for
      every transition, followed by `npm run typecheck`.
      Evidence: Exact allowed/forbidden transition counts, test count, commit SHA,
      and `externalMutations: 0` in the item report.
      HOLD/rollback: Stop if new types require weakening existing verifier contracts
      or if a transition depends on model narration. Revert only the Item 1 commit.

- [x] **2. Add SQLite version 2 and the transactional release-run ledger**
      Spec ref: `Autonomous Release Steward Technical Spec > Persistence model` and
      `> Storage operations`
      What to build: Replace the one-shot bootstrap with ordered migrations; add the
      four release-run structures, strict constraints, indexes, and triggers; then
      implement trigger creation, event/head CAS, due leases, replay, action
      reservation, projection rebuild, and abandoned-work recovery. Preserve all
      version 1 tables and rows.
      Acceptance: Fresh and populated version 1 databases migrate and reopen at
      version 2 without legacy row changes; concurrent claims have one winner;
      events remain contiguous; identical commands replay; rebuilt heads match;
      abandoned reads recover; abandoned `IN_FLIGHT` actions become `UNCERTAIN` and
      never return to `RESERVED`.
      Verify: `npm test --workspace @quietops/storage` with fresh/upgrade/reopen,
      integrity, immutability, rollback, two-ledger race, file-backed recovery,
      replay, conflict, and rebuild cases, then `npm run verify`.
      Evidence: Legacy row counts and hashes, schema/table/index/trigger counts,
      integrity `ok`, lease winner `1`, action-attempt maximum `1`, replay/conflict
      counts, rebuilt-head comparison, and commit SHA.
      HOLD/rollback: Stop on destructive SQL, legacy-byte mutation, partial migration,
      recovery retry of an uncertain action, head change without an event, or ignored
      CAS failure. Restore only the test copy and revert Item 2; never exercise
      rollback against the live volume.

- [x] **3. Add signed, idempotent GitHub push intake**
      Spec ref: `Autonomous Release Steward Technical Spec > Trigger contract`
      What to build: Add the bounded raw-body webhook parser and
      `POST /api/github/webhooks`, behind a default-off runtime flag. Verify
      HMAC-SHA256 before parsing, enforce the fixed repository/ref/action contract,
      deduplicate `X-GitHub-Delivery`, persist the run, and return `202` before work.
      Acceptance: Valid fixed-target deliveries create one run; redelivery replays
      it; invalid signatures return `401`; signed foreign/deleted events create zero
      runs; no raw body, signature, or secret is stored or logged.
      Verify: `npm test --workspace @quietops/adapters` and
      `npm test --workspace @quietops/server` using GitHub's signature test vector,
      malformed/oversized bodies, duplicates, and log-capture assertions.
      Evidence: Run count, duplicate replay count, response status/timing, stored
      payload field list, hard-zero secret matches, and commit SHA.
      HOLD/rollback: Do not create a real GitHub webhook or install a secret. Stop if
      Fastify parses JSON before signature validation or accepts browser-selected
      targets. Revert Item 3 only.

- [x] **4. Add homepage smoke and state-scoped Strands observation tools**
      Spec ref: `Autonomous Release Steward Technical Spec > Observation-cycle contract`
      What to build: Add the construction-bound homepage smoke adapter, dynamic
      Strands tool registry, per-state tool budget/plugin, receipt recorder, and pure
      postcondition validation. Reuse the existing source, CI, and marker collectors.
      Keep `ScriptedEvidenceModel` available only through injected test construction.
      Acceptance: Each state exposes only its required tools; every deployment
      observation includes a homepage smoke; redirect, timeout, oversized, non-HTML,
      unhealthy, duplicate, and foreign-tool cases fail closed; narration cannot
      choose a transition.
      Verify: `npm test --workspace @quietops/adapters` and
      `npm test --workspace @quietops/agent`, then `npm run verify`.
      Evidence: Tool allowlist/call counts by state, receipt/evidence binding, smoke
      limits, external mutation count `0`, and commit SHA.
      HOLD/rollback: Stop if any tool accepts a target from the model/browser, if an
      old deployment skips smoke, or if live mode can silently select the scripted
      model. Revert Item 4 only.

- [ ] **5. Build the durable worker and quiet-completion path**
      Spec ref: `Autonomous Release Steward Technical Spec > Architecture` and
      `> Primary data lifecycle`
      What to build: Add `ReleaseRunService`, projections, and a default-off
      `ReleaseRunWorker` that claims one run, invokes one bounded Strands cycle,
      applies deterministic policy, commits receipts atomically, and shuts down with
      the Fastify lifecycle.
      Acceptance: A signed trigger can progress with the browser closed to the same
      `COMPLETED` run after source, CI, deployment, and smoke converge; duplicate
      triggers and concurrent ticks do not duplicate work; worker-disabled startup
      performs no background activity.
      Verify: Application and server integration tests with injected collectors and
      model, process close/reopen tests, then `npm run verify`.
      Evidence: One run ID, observed state sequence, `humanPrompts: 0`,
      `externalWriteAttempts: 0`, tool counts, shutdown result, and commit SHA.
      HOLD/rollback: Stop if run identity changes, the browser is required, any
      provider write is reachable, or enabling defaults change. Revert Item 5 only.

- [ ] **6. Add real waiting, restart recovery, and the decision envelope**
      Spec ref: `Autonomous Release Steward Technical Spec > State machine` and
      `> Decision envelope and API`
      What to build: Persist `WAITING` before sleep, reclaim due runs after restart,
      perform the second deployment/smoke cycle, and create the single expiring
      decision only after the normal observation budget is exhausted while the old
      deployment remains healthy.
      Acceptance: The delayed path records at least two observations separated by a
      measured wait; restart preserves run ID and next due time; decision facts and
      consequences are complete; unhealthy/missing evidence stops; only one decision
      request exists; expiry stops without action.
      Verify: File-backed application tests with one actual `demo-v1` wait plus
      injected-clock boundary tests, restart before/after due time, and `npm run verify`.
      Evidence: Run ID before/after restart, wait duration, observation count,
      decision count `1`, pre-decision provider writes `0`, and commit SHA.
      HOLD/rollback: Stop if tests replace the required real wait with only a fake
      clock, if a second checkpoint is possible, or if restart creates a child run.
      Revert Item 6 only.

- [ ] **7. Add authenticated decision submission and wait-branch resume**
      Spec ref: `Autonomous Release Steward Technical Spec > Decision envelope and API`
      What to build: Add constant-time operator bearer validation and
      `POST /api/decisions/:decisionId`. Atomically bind the decision to run version,
      candidate, expiry, and idempotency receipt. Implement `WAIT_AND_RECHECK` as the
      only extension and resume the same worker state machine.
      Acceptance: Identical decisions replay; stale, expired, foreign, conflicting,
      unauthenticated, or second decisions fail with the specified status; the token
      never reaches storage/logs; the extension performs one additional real wait and
      can complete or stop without another prompt.
      Verify: `npm test --workspace @quietops/application` and
      `npm test --workspace @quietops/server`, redaction scans, restart during the
      extension, then `npm run verify`.
      Evidence: Authorization event before resume, same run ID, replay count, second
      decision count `0`, provider writes `0`, secret match count `0`, and commit SHA.
      HOLD/rollback: Stop if actor/authority comes from a browser body, the token is
      persisted, or wait creates another decision. Revert Item 7 only.

- [ ] **8. Add the one-attempt incident action behind injected authority**
      Spec ref: `Autonomous Release Steward Technical Spec > Authorized incident action`
      What to build: Add the fixed-repository issue adapter, stable request
      fingerprint, authorized Strands action invocation, and
      `ESCALATE_INCIDENT` resume path. All tests use an injected provider; no live
      GitHub token or network write is allowed in this item.
      Acceptance: Authorization and `RESERVED` commit before access; one action ID
      permits one POST call; valid `201` confirms one receipt; `4xx` rejects;
      timeout/connection loss/`5xx`/invalid success becomes `UNCERTAIN`; restart or
      replay never calls the provider again.
      Verify: Adapter, agent, storage, and application tests with call-counting
      provider doubles for every outcome, crash points before/after the call, and
      `npm run verify`.
      Evidence: Per-case POST call count, event order, request fingerprint, provider
      receipt fields, ambiguity stop code, hard-zero live network writes, commit SHA.
      HOLD/rollback: Stop on any automatic retry, mutable target/body, token
      persistence, or claim of unconditional exactly-once. Revert Item 8 only.

- [ ] **9. Replace the report-first browser with the exception-first product view**
      Spec ref: `Autonomous Release Steward Technical Spec > Query APIs and browser projections`
      What to build: Add run list/detail queries and render current state, required
      attention, autonomous observations, waits, prompts, writes, decision facts,
      consequences, and same-run result before expandable technical receipts. Poll
      active runs; keep operator authority only in memory for one POST.
      Acceptance: No browser control starts the showcased run; normal history shows
      `human prompts: 0`; delayed history makes the human boundary understandable;
      unauthenticated public viewing cannot decide; preserved and live runs are
      labeled; legacy verifier reads remain available.
      Verify: Browser syntax/tests, server projection tests, accessibility checks,
      and local Chrome verification of quiet completion, decision, resume, refresh,
      and narrow viewport; finish with `npm run verify`.
      Evidence: Screenshots of the problem-first, decision, and terminal views;
      DOM/API count agreement; zero console errors; public decision denial; commit SHA.
      HOLD/rollback: Stop if the UI leads with ledger/SHA internals, provides a manual
      Verify button as the core trigger, stores authority, or invents counts. Revert
      Item 9 only.

- [ ] **10. Pass live Bedrock, deployment, webhook, and credential-install gates**
      Spec ref: `Autonomous Release Steward Technical Spec > Runtime and deployment contract`
      and `> Verification strategy > End-to-end gates`
      What to build: First validate the live Bedrock-backed Strands path with no
      provider write. Then prepare a backward-compatible deployment with the worker
      disabled. After separate explicit approvals, install the exact secrets, verify
      one replica and volume, enable the exact webhook/worker, and prove the quiet and
      decision-request paths. Install the fixed-repository issue credential only
      after the action route is held disabled; do not submit an issue in this item.
      Acceptance: Live mode cannot fall back to scripted; `/health`, `/ready`, marker,
      legacy reads, and new run reads pass; signed push reaches quiet completion;
      delayed run waits and asks once; pre-decision effects remain zero; action
      capability remains disabled even after credential installation; duplicate and
      restart probes change no counts.
      Verify: Full CI, dependency audit, exact deployed marker, off-browser signed
      trigger, database reopen, public Chrome journey, action-disabled probe, and
      hard-zero provider-write query.
      Evidence: Exact PR/main/deployment SHAs, CI run, Bedrock model/runtime receipt,
      Railway service/deployment/replica/volume identities, webhook delivery ID, run
      IDs, decision ID, zero-effect counts, credential-presence boolean without secret
      material, timestamps, and rollback readiness.
      HOLD/rollback: Stop independently at `HOLD_AWS_AUTH`, `HOLD_MERGE`,
      `HOLD_DEPLOY`, `HOLD_SECRET_INSTALL`, `HOLD_WEBHOOK_CREATE`, and
      `HOLD_WORKER_ENABLE` until each exact mutation is authorized. End this item at
      `HOLD_FIRST_GITHUB_WRITE`. On failure, disable the worker before any other
      rollback.

- [ ] **11. Perform one authorized live incident action and close the end-to-end proof**
      Spec ref: `Autonomous Release Steward Technical Spec > Authorized incident action`
      and `> Verification strategy > End-to-end gates`
      What to build: With Item 10 receipts current, identify one exact delayed run,
      decision, repository, deterministic issue title/body fingerprint, and action
      ID. Show the pending provider impact, obtain explicit approval for that single
      POST, submit it once, verify the GitHub receipt, and replay the trigger/decision
      without another provider call.
      Acceptance: Authorization precedes `IN_FLIGHT`; the named action attempts one
      POST and confirms one issue; provider URL/number and response digest persist;
      the same run becomes `ESCALATED`; duplicate and restart probes leave issue,
      attempt, authorization, and terminal-event counts unchanged.
      Verify: Read the exact pending action before approval, observe one GitHub issue
      response, fetch the resulting issue read-only, query stored counts, restart the
      service, replay identical commands, run public Chrome verification, and finish
      with full CI.
      Evidence: Approval scope, run/decision/action IDs, request fingerprint, POST
      count `1`, issue URL/number, event ordering, before/after counts, deployed marker,
      CI run, timestamps, and recovery status.
      HOLD/rollback: `HOLD_FIRST_GITHUB_WRITE` remains until the user approves the
      exact displayed action. Do not proceed on stale evidence, target/fingerprint
      drift, non-green CI, or uncertain earlier action state. If the result is
      ambiguous, record `ACTION_OUTCOME_UNCERTAIN` and never retry automatically.

- [ ] **12. Prepare the Devpost handoff**
      Spec ref: `Product Requirements > Submission proof points` and
      `Autonomous Release Steward Technical Spec > Demo and submission flow`
      What to build: Gather the user-first story, architecture diagram, public URL,
      repository/commit, exact test and live receipts, three product screenshots,
      90-second core recording, longer demo instructions, limitations, disclosures,
      and Strands/Bedrock explanation for submission drafting.
      Acceptance: Every submission claim maps to a current receipt; scripted,
      preserved, local, live, and participant-attested evidence are distinct; the
      90-second story shows problem → quiet autonomy → genuine decision → same-run
      bounded outcome; nothing has been submitted.
      Verify: Run a claim-to-evidence audit, link check, clean-browser public demo,
      video timing check, repository license check, and final `npm run verify`; confirm
      the next activity is submission preparation, not submission.
      Evidence: Handoff index with artifact paths/URLs, hashes, timestamps, claim
      owner, evidence class, and unresolved limitations.
      HOLD/rollback: Do not edit or submit a Devpost project, replace public evidence,
      or claim unverified AWS/AgentCore behavior. Return any unsupported claim to the
      relevant checklist item.

## Dependency order

```text
1 contracts/policy
  -> 2 migration + transactional ledger
    -> 3 signed trigger
    -> 4 Strands observation tools
      -> 5 quiet worker path
        -> 6 wait/restart/checkpoint
          -> 7 authenticated wait resume
            -> 8 bounded escalation
              -> 9 product browser
                -> 10 Bedrock/deploy/credential gates (no issue write)
                  -> 11 one explicitly approved live issue
                    -> 12 Devpost handoff
```

## Build-entry gate

Before Item 1, refresh the draft PR, `origin/main`, CI, and public marker. Review
this checklist for scope, mark the documentation PR ready only if still accurate,
and obtain explicit instruction to begin the build. The first implementation
turn then creates a fresh worktree and performs Item 1 only.
