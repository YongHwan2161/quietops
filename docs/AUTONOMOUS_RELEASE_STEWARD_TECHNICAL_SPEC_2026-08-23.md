# Autonomous Release Steward Technical Spec

## Status

`CHECKLIST_READY_BUILD_HOLD`

This specification maps the approved Autonomous Release Steward PRD to the
current QuietOps codebase. It authorizes no implementation, GitHub webhook,
credential, issue write, merge, deployment, or public receipt replacement. The
[build checklist](AUTONOMOUS_RELEASE_STEWARD_BUILD_CHECKLIST_2026-08-23.md)
defines the independently verifiable increments; Item 1 remains on HOLD until
the user explicitly starts the build.

## Overview

QuietOps will accept one authenticated GitHub release trigger, create one durable
release run, and advance it through short Strands observation cycles. A
deterministic state machine owns safety, waits, freshness, budgets, and terminal
states. Strands chooses and sequences only the tools allowed for the current
cycle; model narration never changes policy.

Routine convergence reaches `COMPLETED` with no human prompt and no external
write. A candidate that remains undeployed after the normal observation budget,
while the previous revision is still healthy, creates one expiring decision.
The release owner may grant one more wait or authorize one GitHub incident issue.
QuietOps resumes the same run and records the result.

Implements:

- [PRD Epic 1 — Leave the release watch loop](PRODUCT_REQUIREMENTS.md#epic-1--leave-the-release-watch-loop)
- [PRD Epic 2 — Make safe autonomous progress](PRODUCT_REQUIREMENTS.md#epic-2--make-safe-autonomous-progress)
- [PRD Epic 3 — Ask one question only a person can answer](PRODUCT_REQUIREMENTS.md#epic-3--ask-one-question-only-a-person-can-answer)
- [PRD Epic 4 — Resume and carry out the decision once](PRODUCT_REQUIREMENTS.md#epic-4--resume-and-carry-out-the-decision-once)
- [PRD Epic 5 — Make saved attention visible](PRODUCT_REQUIREMENTS.md#epic-5--make-saved-attention-visible)

## Current baseline and required change

| Concern          | Current code                                                                  | Required P0 change                                                                                         |
| ---------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Trigger          | `POST /api/live-verifications` is user-started                                | Signed GitHub `push` webhook creates the run and returns `202` before work begins                          |
| Agent lifecycle  | One scripted Strands invocation calls three fixed tools                       | One live Bedrock-backed Strands invocation per durable observation cycle; scripted model remains test-only |
| Persistence      | The evaluation is committed after all collection completes                    | Run identity and every transition are committed before waits, decisions, and external actions              |
| Waiting          | No durable scheduler or intermediate state                                    | SQLite-backed due time, lease, restart recovery, and one policy-bounded extension                          |
| Decision         | `Reject` or `Re-check requested` acknowledges a completed mismatch evaluation | One expiring `WAIT_AND_RECHECK` or `ESCALATE_INCIDENT` decision resumes the same active run                |
| External effects | Every current tool records `externalMutations: 0`                             | Reads remain zero-write; one issue attempt becomes available only after durable escalation authorization   |
| Public browser   | Anonymous and read-only                                                       | Public evidence remains readable; decision POST requires an operator bearer secret                         |

The existing `evaluations`, `evaluation_events`, and `idempotency_records` data
remain readable as legacy verifier evidence. The new workflow does not reinterpret
old evaluations as autonomous release runs.

## Stack

- TypeScript on the repository's pinned Node.js 22 runtime.
- `@strands-agents/sdk` `1.13.0`, retaining Zod-validated custom tools and plugin
  hooks.
- Fastify `5.12.1` for webhook, run-query, and decision endpoints.
- Node's synchronous `node:sqlite` `DatabaseSync` on the existing Railway volume.
- Native `fetch`, `node:crypto`, and construction-bound adapters; no general HTTP,
  shell, browser-control, or arbitrary repository tool.
- Static HTML, CSS, and JavaScript for the exception-first browser.
- One Railway process and exactly one replica for the SQLite-backed P0 worker.

No new queue, client framework, ORM, multi-agent runtime, or browser automation
dependency is justified for P0.

## Architecture

```text
GitHub push webhook
  -> Fastify signature and allowlist boundary
  -> ReleaseRunService.createFromTrigger()
  -> SQLite run + event + mutable head transaction
  -> 202 Accepted

ReleaseRunWorker
  -> atomically claim one due run
  -> ReleaseStewardAgent (one short Strands invocation)
       -> fixed source / CI / deployment / homepage-smoke tools
       -> state-specific tool budget and hooks
  -> deterministic ReleaseStewardPolicy
  -> append receipts and CAS-transition the run head
       -> WAITING -> later claim
       -> COMPLETED / STOPPED
       -> AWAITING_DECISION

Authenticated human decision
  -> persist decision and resume plan atomically
  -> WAITING, or RESUMING with one reserved incident action
  -> authorized Strands action invocation
       -> construction-bound GitHub issue writer
  -> ESCALATED, or STOPPED if rejected/uncertain

Browser
  -> read run inbox and detail projections
  -> show attention and effect counts first
  -> submit one authenticated decision when allowed
```

## State machine

The persisted state vocabulary is exactly:

- `MONITORING`
- `WAITING`
- `AWAITING_DECISION`
- `RESUMING`
- `COMPLETED`
- `ESCALATED`
- `STOPPED`

`COMPLETED`, `ESCALATED`, and `STOPPED` are terminal. An external action with an
indeterminate provider result is represented by terminal `STOPPED` plus
`stopCode: ACTION_OUTCOME_UNCERTAIN`; it is never converted into a human approval.

| From                | Condition or command                                                                | Durable work                                            | To                  |
| ------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------- |
| none                | Valid, allowlisted, non-duplicate `push` delivery                                   | Create run, trigger receipt, head version `1`           | `MONITORING`        |
| `MONITORING`        | Required CI failed, evidence invalid/unavailable, or previous deployment unhealthy  | Append evidence and stop reason                         | `STOPPED`           |
| `MONITORING`        | Candidate deployed and homepage smoke passes                                        | Append cycle receipts and zero-write completion         | `COMPLETED`         |
| `MONITORING`        | Candidate absent, previous deployment healthy, normal observation remains           | Append real wait duration and `nextWakeAt`              | `WAITING`           |
| `WAITING`           | `nextWakeAt <= now` and lease claimed                                               | Append wake event                                       | `MONITORING`        |
| `MONITORING`        | Candidate still absent and normal observation budget exhausted                      | Append one fresh decision envelope and expiry           | `AWAITING_DECISION` |
| `AWAITING_DECISION` | Valid `WAIT_AND_RECHECK`                                                            | Append authorization and one extension wait             | `WAITING`           |
| `AWAITING_DECISION` | Valid `ESCALATE_INCIDENT`                                                           | Append authorization and reserve one action             | `RESUMING`          |
| `AWAITING_DECISION` | Decision expires                                                                    | Append expiry stop reason                               | `STOPPED`           |
| `MONITORING`        | Extension observation converges and smoke passes                                    | Append completion                                       | `COMPLETED`         |
| `MONITORING`        | Extension was consumed and candidate is still absent                                | Append extension-exhausted reason; do not ask again     | `STOPPED`           |
| `RESUMING`          | Issue POST returns a valid `201` receipt                                            | Append confirmed action receipt                         | `ESCALATED`         |
| `RESUMING`          | Provider rejects the request before acceptance is possible                          | Append rejected action receipt                          | `STOPPED`           |
| `RESUMING`          | Timeout, connection loss, `5xx`, or invalid success body makes acceptance uncertain | Append uncertainty; automatic attempts remain exhausted | `STOPPED`           |

Additional transition rules:

- A newer candidate stops the older non-terminal run with
  `stopCode: SUPERSEDED`; its webhook creates a new run.
- A decision is rejected if its run, decision ID, candidate commit, expected run
  version, expiry, or idempotency request does not match current state.
- A run may contain one decision request and one decision record only.
- `WAIT_AND_RECHECK` consumes the only human checkpoint even if the extra wait
  does not resolve the rollout.

## Policy profile

Every run stores an immutable policy profile and version. Two named profiles are
allowed so tests and the 90-second demonstration do not silently change the
production-shaped contract:

| Field                           |  `demo-v1` | `standard-v1` |
| ------------------------------- | ---------: | ------------: |
| Normal deployment observations  |          2 |             3 |
| Delay between observations      |  5 seconds |    60 seconds |
| Human decision TTL              | 15 minutes |    30 minutes |
| One authorized extension        |  5 seconds |    60 seconds |
| Maximum human decisions         |          1 |             1 |
| Maximum incident write attempts |          1 |             1 |
| Individual provider timeout     |  8 seconds |     8 seconds |

The profile name and all resolved values are persisted in `release_runs`. Tests
inject a clock; live code must perform a real wait rather than advance a fake
clock. The demo UI labels `demo-v1` clearly.

## Persistence model

The current migration bootstrap must become an ordered migration runner. Schema
version `2` adds four workflow structures while preserving the version `1`
verifier tables.

### `release_runs` — immutable identity

| Column                | Contract                                                           |
| --------------------- | ------------------------------------------------------------------ |
| `run_id`              | Primary key                                                        |
| `repository`          | Exact allowlisted `YongHwan2161/quietops`                          |
| `branch`              | Exact allowlisted `main`                                           |
| `candidate_commit`    | Full lowercase SHA from the trigger, reverified by the source tool |
| `trigger_delivery_id` | Unique GitHub `X-GitHub-Delivery` value                            |
| `policy_profile_json` | Canonical immutable policy name, version, and limits               |
| `created_at`          | UTC ISO timestamp                                                  |

Updates and deletes are rejected by triggers.

### `release_run_events` — append-only audit truth

| Column         | Contract                                                         |
| -------------- | ---------------------------------------------------------------- |
| `event_id`     | Primary key                                                      |
| `run_id`       | Foreign key to `release_runs`                                    |
| `sequence`     | Positive, contiguous sequence; unique with `run_id`              |
| `event_type`   | Closed vocabulary validated by projections                       |
| `occurred_at`  | UTC ISO timestamp                                                |
| `payload_json` | Canonical bounded JSON without credentials or raw webhook bodies |

Partial unique indexes enforce one `decision-requested` and one
`decision-recorded` event per run. Updates and deletes are rejected by triggers.

### `release_run_heads` — rebuildable operational projection

| Column                             | Contract                                                 |
| ---------------------------------- | -------------------------------------------------------- |
| `run_id`                           | Primary key                                              |
| `state`                            | Current state from the closed vocabulary                 |
| `version`                          | Last committed event sequence; used for compare-and-swap |
| `next_wake_at`                     | Due time for wait or decision expiry, otherwise null     |
| `active_decision_id`               | Current decision only while awaiting it                  |
| `lease_owner` / `lease_expires_at` | Short worker lease; never authorization                  |
| `updated_at`                       | Projection update time                                   |

This table is mutable because it is an operational index, not audit evidence. It
must be reproducible from `release_runs` and `release_run_events`. Every head
change and its events commit in one `BEGIN IMMEDIATE` transaction with
`WHERE version = expectedVersion`; a zero-row update is a concurrency conflict.

### `external_actions` — bounded effect projection

| Column                                | Contract                                                         |
| ------------------------------------- | ---------------------------------------------------------------- |
| `action_id`                           | Stable primary key generated before provider access              |
| `run_id` / `action_type`              | Unique pair; P0 type is `CREATE_GITHUB_INCIDENT`                 |
| `request_fingerprint`                 | SHA-256 of canonical repository, title, body, and run marker     |
| `status`                              | `RESERVED`, `IN_FLIGHT`, `CONFIRMED`, `REJECTED`, or `UNCERTAIN` |
| `attempt_count`                       | Integer constrained to `0` or `1`                                |
| `provider_record_id` / `provider_url` | Present only after validated confirmation                        |
| `response_digest`                     | Digest of the bounded response fields; no token or raw headers   |
| timestamps                            | Creation and last projection update                              |

`idempotency_records` remains the common command-replay store. New scopes are
`release-trigger:<repository>`, `release-decision:<decisionId>`, and
`release-action:<actionId>`.

## Storage operations

`SQLiteReleaseRunLedger` exposes transactions rather than generic SQL:

- `createRunFromWebhook(trigger)` — atomically deduplicates the delivery and
  creates the run, initial event, head, and idempotency receipt.
- `claimNextDueRun(workerId, now, leaseDuration)` — claims one due non-terminal
  head under `BEGIN IMMEDIATE`; no external call occurs inside the transaction.
- `appendTransition(runId, expectedVersion, events, nextHead)` — validates
  contiguous sequence and performs the event/head CAS update atomically.
- `recordDecision(command)` — validates current envelope and atomically stores
  the decision, replay receipt, and either wait transition or action reservation.
- `beginExternalAction(actionId, expectedRunVersion)` — changes the action from
  `RESERVED` to `IN_FLIGHT`, sets `attempt_count = 1`, and appends the attempt
  event before the HTTP request.
- `finishExternalAction(actionId, result)` — stores one confirmed, rejected, or
  uncertain receipt and a terminal transition.
- `recoverAbandonedWork(now)` — clears expired observation leases; any abandoned
  `IN_FLIGHT` external action becomes `UNCERTAIN` and is never retried.

The existing `SQLiteEvaluationLedger` remains untouched until a later cleanup.

## Trigger contract

### `POST /api/github/webhooks`

Required headers:

- `X-GitHub-Event: push`
- `X-GitHub-Delivery: <UUID-like bounded identifier>`
- `X-Hub-Signature-256: sha256=<digest>`
- `Content-Type: application/json`

Processing order:

1. Read at most 256 KiB of the raw body.
2. Verify HMAC-SHA256 against `QUIETOPS_GITHUB_WEBHOOK_SECRET` with
   constant-time comparison before JSON parsing.
3. Require event `push`, repository `YongHwan2161/quietops`, ref
   `refs/heads/main`, non-deleted push, and a full lowercase `after` SHA.
4. Persist or replay the trigger transaction using `X-GitHub-Delivery`.
5. Return `202` with `{ runId, replayed }` within GitHub's delivery window.
6. Let the worker perform all provider reads after the response.

Invalid signatures return `401`; well-signed but foreign events return `202`
with `accepted: false` and create no run. The raw body, signature, and webhook
secret are never persisted.

Webhook creation and secret installation are external configuration gates and
require separate authorization after implementation and local signature tests.

## Observation-cycle contract

Each worker claim creates one new Strands `Agent` invocation from the persisted
run projection. Durable state belongs to SQLite, not the model conversation.

### Read tools

- `observe_source_revision` — existing fixed GitHub source collector.
- `observe_required_ci` — existing fixed required-workflow collector.
- `observe_deployment_revision` — existing fixed Railway marker collector.
- `observe_homepage_smoke` — new construction-bound HTTPS GET for `/`.
- `schedule_recheck` — returns the policy-clamped wait proposal; the application
  persists and performs the wait after the invocation ends.

`observe_homepage_smoke` accepts no URL input. It rejects redirects, credentials,
non-HTML responses, bodies over 256 KiB, and responses beyond eight seconds. It
requires HTTP `200` plus the stable
`data-quietops-product="release-steward"` marker in the served HTML. The timeout
covers both response headers and the complete bounded body. Deployment
identity remains the separate signed-by-configuration release-marker claim; the
smoke collector does not pretend to prove a commit.

### Per-state allowlist

- First observation: source, CI, deployment, and homepage smoke. Matching
  deployment plus healthy smoke may complete; old deployment plus healthy smoke
  may schedule a recheck. An unhealthy smoke result stops either path.
- Later normal observation: deployment and homepage smoke, then completion or a
  scheduled recheck. The immutable completed CI/source receipts are referenced
  by ID.
- Extension observation: deployment and homepage smoke; no second checkpoint
  tool is available.
- Escalation resume: only the authorized incident tool is available.

`ReleaseStewardToolBudget` rejects foreign tools, duplicate calls, and calls not
valid for the current state. After invocation, deterministic policy rejects an
incomplete or impossible receipt sequence. The scripted model is allowed only in
tests and labeled preserved demonstrations. The competition path must fail
closed if the configured live Bedrock model cannot run; it must not silently fall
back to the scripted model.

## Decision envelope and API

The `decision-requested` payload contains:

- `decisionId`, `runId`, candidate commit, and expected run version;
- current source, CI, deployment, and health evidence IDs and fetch times;
- observation count, wait count, and elapsed duration;
- plain-language statement of missing context;
- exactly `WAIT_AND_RECHECK` and `ESCALATE_INCIDENT`, with consequences;
- `createdAt`, `expiresAt`, policy profile, and idempotency scope.

### `POST /api/decisions/:decisionId`

Headers:

- `Authorization: Bearer <operator token>`
- `Idempotency-Key: <bounded client-generated key>`

Body:

```json
{
  "choice": "WAIT_AND_RECHECK",
  "expectedRunVersion": 12
}
```

The server derives the actor as `release-owner`; it does not trust a browser
actor field. `QUIETOPS_OPERATOR_TOKEN` is a high-entropy deployment secret,
compared in constant time, never logged or persisted. The static browser keeps
it in memory for one submission and never writes it to storage, URL, or HTML.

The endpoint returns `200` with the original receipt on an identical replay,
`409` for a stale version or conflicting idempotency request, `410` for expiry,
and `401` for missing or invalid operator authority. Public GET routes remain
anonymous and read-only.

## Authorized incident action

`ESCALATE_INCIDENT` creates an immutable action plan whose repository is fixed at
construction. The issue title and body are deterministic and include the stable
marker `QuietOps-Run: <runId>` plus candidate, evidence links, observation count,
wait duration, decision ID, and authorization time.

The adapter uses a repository-scoped fine-grained token with only Issues write
permission and calls `POST /repos/YongHwan2161/quietops/issues` once. A successful
receipt requires HTTP `201`, an integer issue number, and a GitHub `html_url`.
Tokens, request headers, and unrestricted response bodies are never stored.

### Honest exactly-once boundary

SQLite and GitHub cannot share a transaction, and GitHub's create-issue endpoint
does not expose a provider idempotency key. QuietOps therefore guarantees:

- duplicate triggers and decisions do not reserve another action;
- one action ID permits at most one automatic HTTP POST attempt;
- a confirmed run contains exactly one validated issue receipt; and
- any ambiguous outcome stops without automatic retry.

It does **not** claim that a network failure can prove whether GitHub accepted
the request. The competition claim is “one authorized attempt; one confirmed
issue in the successful demo,” not unconditional distributed exactly-once.

## Query APIs and browser projections

- `GET /api/release-runs` — exception-first inbox plus capabilities.
- `GET /api/release-runs/:runId` — current projection, decision envelope,
  timeline, receipts, and effect counts.
- Existing `/api/inbox` and `/api/evaluations/:evaluationId` remain legacy
  verifier reads during migration.
- Existing anonymous legacy decision POST remains disabled in public mode and is
  removed only after the new flow passes compatibility tests.

The browser polls the active detail every two seconds while a run is non-terminal;
SSE is not required for P0. The first screen shows state, attention requirement,
autonomous observations, policy waits, human prompts, and external writes. Tool
receipts and implementation detail remain expandable evidence.

## File structure

```text
packages/
  contracts/src/
    release-run.ts                 closed run states and public projections
    decision-envelope.ts           two-choice, freshness, and resume contract
    external-action.ts             bounded action and provider receipt types
  adapters/src/
    github-webhook.ts              raw-body signature and fixed payload parser
    homepage-smoke.ts              construction-bound user-facing GET check
    github-issue.ts                one fixed-repository issue POST adapter
  agent/src/
    release-steward.ts             one Strands observation/action invocation
    release-steward-tools.ts       state-specific custom tool registry
    release-steward-policy.ts      deterministic transition and budget rules
    release-steward-tool-budget.ts per-state hook/plugin enforcement
  storage/src/
    sqlite-migrations.ts           ordered schema versions 1 -> 2
    sqlite-release-run-ledger.ts   transactional events, heads, leases, actions
  application/src/
    release-run-service.ts         trigger, decision, and query use cases
    release-run-worker.ts          claim, invoke, transition, recovery loop
    release-run-projection.ts      rebuild and API projection invariants
  server/src/
    github-webhook-route.ts        signed intake and 202 response
    release-run-routes.ts          inbox, detail, and decision endpoints
    operator-auth.ts               constant-time bearer verification
    server.ts                      wire routes without removing legacy reads
    cli.ts                         start/stop the worker with Fastify lifecycle
  server/public/
    app.js                         render new run projections and one decision

packages/*/test/
  corresponding focused contract, adapter, agent, storage, service, worker,
  route, restart, and browser tests
```

No file accepts an arbitrary repository, deployment URL, smoke URL, issue body,
or tool name from the browser or model.

## Primary data lifecycle

1. GitHub sends a signed `push` delivery for `main`.
2. The webhook adapter validates raw bytes and reduces the payload to fixed,
   bounded trigger fields.
3. The service commits run identity, initial event, head, and delivery receipt,
   then returns `202`.
4. The worker claims the head, invokes Strands with only cycle-valid tools, and
   receives bounded observations.
5. Deterministic policy converts receipts into one atomic event/head transition.
6. A wait stores its due time before the worker sleeps; restart scanning finds it.
7. A decision envelope is derived from stored evidence and bound to one run
   version and expiry.
8. An authenticated choice atomically records authorization and the next plan.
9. The wait branch returns to the worker; the escalation branch reserves and
   attempts one provider action.
10. Browser projections reconstruct the same run and report measured attention
    and effect counts from events.

## Runtime and deployment contract

New configuration is fail-closed:

- `QUIETOPS_WORKER_ENABLED=true`
- `QUIETOPS_SINGLE_REPLICA_CONFIRMED=true` only after external topology verification
- `QUIETOPS_POLICY_PROFILE=demo-v1|standard-v1`
- `QUIETOPS_GITHUB_WEBHOOK_ENABLED=true`
- `QUIETOPS_GITHUB_WEBHOOK_SECRET=<secret>`
- `QUIETOPS_OPERATOR_TOKEN=<secret>`
- `QUIETOPS_GITHUB_ISSUE_TOKEN=<repo-scoped secret>`
- `QUIETOPS_GITHUB_ISSUE_ACTION_ENABLED=false` until the separately authorized write gate
- existing fixed host, database path, release commit, and public-mode settings

Worker mode requires an absolute external SQLite path, operator authentication,
all three secrets, an explicit policy profile, live Bedrock configuration, and a
verified single-replica deployment. The service refuses to start the worker if
any value is absent. Installing the issue token does not enable issue creation:
the separate issue-action flag remains false through Item 10, and escalation
requests fail before authorization persistence while it is false. Secret values
must never appear in startup JSON.

`GET /health` remains liveness-only. A new anonymous, non-sensitive `GET /ready`
returns HTTP `200` with
`{ "status": "ready", "database": true, "worker": true, "migrationVersion": 2 }`
only when SQLite integrity, migration version, worker heartbeat, and required
configuration pass. It returns HTTP `503` with false component flags otherwise
and exposes no paths or secrets.

On shutdown, Fastify stops new claims, waits a bounded period for read-only work,
and closes SQLite. An `IN_FLIGHT` action that lacks a confirmed receipt at next
startup is marked uncertain, never retried.

## External APIs and official references

- [Strands TypeScript quickstart](https://strandsagents.com/docs/user-guide/quickstart/typescript/)
- [Strands custom tools](https://strandsagents.com/docs/user-guide/concepts/tools/custom-tools/)
- [Strands hooks and plugins](https://strandsagents.com/docs/user-guide/concepts/agents/hooks/)
- [GitHub webhook signature validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [GitHub webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)
- [GitHub create-issue REST endpoint](https://docs.github.com/en/rest/issues/issues#create-an-issue)
- [GitHub REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- [Node.js `node:sqlite`](https://nodejs.org/download/release/latest-v22.x/docs/api/sqlite.html)
- [Fastify documentation](https://fastify.dev/docs/latest/)

## Verification strategy

### Contract and policy

- Reject unknown states, choices, action types, fields, and malformed timestamps.
- Table-test every state transition and every forbidden transition.
- Prove failed CI, unhealthy deployment, missing evidence, stale decision, and
  extension exhaustion never create a decision or action.

### Storage and recovery

- Prove run/event immutability and contiguous sequence.
- Race two claims and prove one lease winner.
- Restart from `WAITING`, `AWAITING_DECISION`, `RESUMING/RESERVED`, and
  `RESUMING/IN_FLIGHT`.
- Prove identical trigger/decision replay and conflicting-key rejection.
- Rebuild each head from events and compare every field.

### Agent and adapters

- Prove per-state tool allowlists, call counts, and receipt ordering.
- Prove live mode cannot fall back to `ScriptedEvidenceModel`.
- Bound webhook body, HMAC verification, redirects, response size, timeout, and
  fixed targets.
- Inject issue outcomes for `201`, deterministic `4xx`, timeout, connection loss,
  `5xx`, and invalid response; assert POST call count never exceeds one.

### End-to-end gates

- Signed trigger with browser closed reaches quiet `COMPLETED` with
  `humanPrompts=0`, `externalWriteAttempts=0`, and a smoke receipt.
- Delayed run records two deployment observations separated by a measured wait.
- Restart during `WAITING` resumes the same run ID.
- One fresh escalation decision resumes the same run and produces one confirmed
  issue receipt.
- Replaying trigger and decision changes no counts and creates no second issue.
- Ambiguous write reaches `STOPPED/ACTION_OUTCOME_UNCERTAIN` without retry.
- Full `npm run verify`, dependency audit, link check, and public browser smoke
  pass before deployment consideration.

## Risks and architecture self-review

### 1. External exactly-once is impossible to prove unconditionally

The one-attempt plus uncertainty-stop contract is less convenient than retrying,
but it is the only honest P0 claim without a provider idempotency guarantee. A
later reconciliation workflow may search a dedicated provider marker, but it
must not be introduced as a hidden retry.

### 2. SQLite requires a single-writer deployment boundary

The current Railway volume and synchronous connection are appropriate for one
small demo worker, not horizontal scaling. Replica count must remain one and be
verified outside `railway.json`. Multi-replica support requires a different
coordination store and is out of scope.

### 3. Live model behavior can stall the demo

Dynamic Strands behavior is important for the competition, but safety does not
depend on it. State-specific tools, postconditions, and deterministic policy
bound failures. A preserved scripted trace may explain tests, but cannot be
presented as the live competition path.

### 4. Webhook and write credentials add a real security boundary

Secrets, raw payloads, and authorization headers need redaction tests. Webhook
installation, operator secret installation, and issue token installation remain
explicit external gates. No credential belongs in repository files or demo
exports.

### 5. The design is near the P0 complexity limit

The mutable head and action projections are justified by restart recovery and
effect control. SSE, arbitrary repositories, generic auth, notifications,
Playwright, a second write action, and multi-provider support are cut because
they do not strengthen the 90-second proof enough to justify their risk.

## Demo and submission flow

1. Open QuietOps to an empty current-release panel; no action starts from the
   browser.
2. Push a prepared candidate and show the signed delivery receipt creating a run.
3. Show Strands tool activity, one quiet completion, and the four measured counts.
4. Trigger the prepared delayed candidate and show a real wait and re-check.
5. Open the single decision envelope and explain why either choice may be valid.
6. Enter operator authority and choose `ESCALATE_INCIDENT`.
7. Show the same run resume, one GitHub issue receipt, and replay with unchanged
   counts.
8. Close on the user benefit; expand hashes and ledger receipts only as proof.

The live public site may expose read-only run evidence without sharing operator
authority. A recorded or supervised judge session demonstrates the real write.
The submission must label any preserved run separately from current live state.

## Checklist handoff

The
[build checklist](AUTONOMOUS_RELEASE_STEWARD_BUILD_CHECKLIST_2026-08-23.md)
decomposes this spec into 12 narrow increments with separate pass gates for
contracts, migration, trigger, durable worker, quiet path, decision, wait resume,
issue adapter, authenticated browser, live Bedrock, deployment configuration,
and final end-to-end evidence. It keeps the first live credential installation
separate from the first provider write.
