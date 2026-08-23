import {
  parseDecisionChoice,
  parseExternalActionProjection,
  parsePolicyProfile,
  type DecisionChoice,
  type ExternalActionStatus,
  type PolicyProfile,
  type ReleaseRunState,
} from "@quietops/contracts";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  IdempotencyConflictError,
  type JsonObject,
} from "./sqlite-evaluation-ledger.js";
import {
  assertIdentifier,
  assertSafeJsonObject,
  assertUtcTimestamp,
  canonicalJson,
  parseStoredJsonObject,
  rebuildReleaseRunHead,
  type NewReleaseRunEvent,
  type RebuiltReleaseRunHead,
  type StoredReleaseRunEvent,
} from "./release-run-event-projection.js";
import { applySQLiteMigrations } from "./sqlite-migrations.js";

export interface CreateRunFromWebhook {
  readonly runId: string;
  readonly triggerEventId: string;
  readonly repository: "YongHwan2161/quietops";
  readonly branch: "main";
  readonly candidateCommit: string;
  readonly triggerDeliveryId: string;
  readonly policyProfile: PolicyProfile;
  readonly createdAt: string;
}

export interface CreateRunFromWebhookResult {
  readonly runId: string;
  readonly replayed: boolean;
  readonly head: StoredReleaseRunHead;
}

export interface StoredReleaseRun {
  readonly runId: string;
  readonly repository: "YongHwan2161/quietops";
  readonly branch: "main";
  readonly candidateCommit: string;
  readonly triggerDeliveryId: string;
  readonly policyProfile: PolicyProfile;
  readonly createdAt: string;
}

export interface StoredReleaseRunHead {
  readonly runId: string;
  readonly state: ReleaseRunState;
  readonly version: number;
  readonly nextWakeAt: string | null;
  readonly activeDecisionId: string | null;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly updatedAt: string;
}

export interface NextReleaseRunHead {
  readonly state: ReleaseRunState;
  readonly nextWakeAt: string | null;
  readonly activeDecisionId: string | null;
  readonly updatedAt: string;
}

export interface AppendReleaseRunTransition {
  readonly runId: string;
  readonly expectedVersion: number;
  readonly events: readonly NewReleaseRunEvent[];
  readonly nextHead: NextReleaseRunHead;
}

export interface ReservedExternalAction {
  readonly actionId: string;
  readonly requestFingerprint: string;
}

export interface RecordReleaseDecision {
  readonly decisionId: string;
  readonly runId: string;
  readonly candidateCommit: string;
  readonly expectedRunVersion: number;
  readonly idempotencyKey: string;
  readonly eventId: string;
  readonly actionEventId: string | null;
  readonly choice: DecisionChoice;
  readonly occurredAt: string;
  readonly waitUntil: string | null;
  readonly action: ReservedExternalAction | null;
}

export interface RecordReleaseDecisionResult {
  readonly runId: string;
  readonly decisionId: string;
  readonly choice: DecisionChoice;
  readonly state: Extract<ReleaseRunState, "WAITING" | "RESUMING">;
  readonly version: number;
  readonly actionId: string | null;
  readonly replayed: boolean;
}

export interface BeginExternalAction {
  readonly actionId: string;
  readonly expectedRunVersion: number;
  readonly eventId: string;
  readonly occurredAt: string;
}

export type FinishExternalActionResult =
  | {
      readonly status: "CONFIRMED";
      readonly providerRecordId: string;
      readonly providerUrl: string;
      readonly responseDigest: string;
    }
  | {
      readonly status: "REJECTED" | "UNCERTAIN";
      readonly providerRecordId: null;
      readonly providerUrl: null;
      readonly responseDigest: string | null;
    };

export interface FinishExternalAction {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly result: FinishExternalActionResult;
}

export interface FinishExternalActionResponse {
  readonly actionId: string;
  readonly runId: string;
  readonly status: Extract<
    ExternalActionStatus,
    "CONFIRMED" | "REJECTED" | "UNCERTAIN"
  >;
  readonly state: Extract<ReleaseRunState, "ESCALATED" | "STOPPED">;
  readonly version: number;
  readonly replayed: boolean;
}

export interface StoredExternalAction {
  readonly actionId: string;
  readonly runId: string;
  readonly actionType: "CREATE_GITHUB_INCIDENT";
  readonly repository: "YongHwan2161/quietops";
  readonly requestFingerprint: string;
  readonly status: ExternalActionStatus;
  readonly attemptCount: 0 | 1;
  readonly providerRecordId: string | null;
  readonly providerUrl: string | null;
  readonly responseDigest: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RecoverAbandonedWorkResult {
  readonly clearedObservationLeases: number;
  readonly uncertainActions: number;
  readonly recoveredRunIds: readonly string[];
}

export class ReleaseRunConcurrencyError extends Error {
  readonly code = "RELEASE_RUN_CONCURRENCY_CONFLICT" as const;

  constructor(runId: string, expectedVersion: number) {
    super(
      `Release run ${runId} is not at expected version ${expectedVersion}.`,
    );
    this.name = "ReleaseRunConcurrencyError";
  }
}

export class ReleaseRunStateError extends Error {
  readonly code = "RELEASE_RUN_STATE_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "ReleaseRunStateError";
  }
}

export class ExternalActionAlreadyAttemptedError extends Error {
  readonly code = "EXTERNAL_ACTION_ALREADY_ATTEMPTED" as const;

  constructor(actionId: string) {
    super(`External action ${actionId} is not available for another attempt.`);
    this.name = "ExternalActionAlreadyAttemptedError";
  }
}

interface ReleaseRunRow {
  readonly run_id: string;
  readonly repository: string;
  readonly branch: string;
  readonly candidate_commit: string;
  readonly trigger_delivery_id: string;
  readonly policy_profile_json: string;
  readonly created_at: string;
}

interface HeadRow {
  readonly run_id: string;
  readonly state: string;
  readonly version: number;
  readonly next_wake_at: string | null;
  readonly active_decision_id: string | null;
  readonly lease_owner: string | null;
  readonly lease_expires_at: string | null;
  readonly updated_at: string;
}

interface EventRow {
  readonly event_id: string;
  readonly run_id: string;
  readonly sequence: number;
  readonly event_type: string;
  readonly occurred_at: string;
  readonly payload_json: string;
}

interface ActionRow {
  readonly action_id: string;
  readonly run_id: string;
  readonly action_type: string;
  readonly request_fingerprint: string;
  readonly status: string;
  readonly attempt_count: number;
  readonly provider_record_id: string | null;
  readonly provider_url: string | null;
  readonly response_digest: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface IdempotencyRow {
  readonly request_json: string;
  readonly response_json: string;
}

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

export class SQLiteReleaseRunLedger {
  readonly #database: DatabaseSync;
  #closed = false;

  constructor(path = ":memory:") {
    this.#database = new DatabaseSync(path);
    applySQLiteMigrations(this.#database);
  }

  createRunFromWebhook(
    trigger: CreateRunFromWebhook,
  ): CreateRunFromWebhookResult {
    this.#requireOpen();
    validateTrigger(trigger);
    const policyProfile = parsePolicyProfile(trigger.policyProfile);
    const scope = `release-trigger:${trigger.repository}`;
    const request = triggerRequest(trigger, policyProfile);

    return this.#transaction(() => {
      const existing = this.#readIdempotency(scope, trigger.triggerDeliveryId);
      if (existing) {
        this.#assertSameIdempotencyRequest(
          scope,
          trigger.triggerDeliveryId,
          request,
          existing.request_json,
        );
        const response = parseStoredJsonObject(
          existing.response_json,
          "release trigger response",
        );
        const runId = requireString(response.runId, "stored trigger run ID");
        const head = this.#requireHead(runId);
        return freeze({ runId, replayed: true, head });
      }

      this.#database
        .prepare(
          `INSERT INTO release_runs(
            run_id, repository, branch, candidate_commit, trigger_delivery_id,
            policy_profile_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          trigger.runId,
          trigger.repository,
          trigger.branch,
          trigger.candidateCommit,
          trigger.triggerDeliveryId,
          canonicalJson(policyProfileToJson(policyProfile)),
          trigger.createdAt,
        );

      const event: StoredReleaseRunEvent = freeze({
        runId: trigger.runId,
        eventId: trigger.triggerEventId,
        sequence: 1,
        eventType: "release-triggered",
        occurredAt: trigger.createdAt,
        payload: freeze({
          signal: "TRIGGER_ACCEPTED",
          deliveryId: trigger.triggerDeliveryId,
          nextWakeAt: null,
          activeDecisionId: null,
          stopCode: null,
        }),
      });
      this.#insertEvent(event);
      const rebuilt = rebuildReleaseRunHead(trigger.runId, [event]);
      this.#insertHead(rebuilt);

      const response = freeze({ runId: trigger.runId });
      this.#insertIdempotency(
        scope,
        trigger.triggerDeliveryId,
        request,
        response,
        trigger.createdAt,
      );
      return freeze({
        runId: trigger.runId,
        replayed: false,
        head: mapRebuiltHead(rebuilt),
      });
    });
  }

  claimNextDueRun(
    workerId: string,
    now: string,
    leaseDurationMs: number,
  ): StoredReleaseRunHead | undefined {
    this.#requireOpen();
    assertIdentifier(workerId, "worker ID");
    assertUtcTimestamp(now, "claim time");
    if (
      !Number.isSafeInteger(leaseDurationMs) ||
      leaseDurationMs < 1 ||
      leaseDurationMs > 5 * 60_000
    ) {
      throw new Error("Lease duration is outside the bounded range.");
    }
    const leaseExpiresAt = new Date(
      Date.parse(now) + leaseDurationMs,
    ).toISOString();

    return this.#transaction(() => {
      const row = this.#database
        .prepare(
          `SELECT ${HEAD_COLUMNS}
           FROM release_run_heads
           WHERE state IN ('MONITORING', 'WAITING', 'AWAITING_DECISION', 'RESUMING')
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
             AND (
               state IN ('MONITORING', 'RESUMING')
               OR (state IN ('WAITING', 'AWAITING_DECISION') AND next_wake_at <= ?)
             )
           ORDER BY COALESCE(next_wake_at, updated_at) ASC, run_id ASC
           LIMIT 1`,
        )
        .get(now, now) as HeadRow | undefined;
      if (!row) return undefined;

      const result = this.#database
        .prepare(
          `UPDATE release_run_heads
           SET lease_owner = ?, lease_expires_at = ?
           WHERE run_id = ?
             AND version = ?
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
        )
        .run(workerId, leaseExpiresAt, row.run_id, row.version, now);
      if (Number(result.changes) !== 1) {
        throw new ReleaseRunConcurrencyError(row.run_id, row.version);
      }
      return this.#requireHead(row.run_id);
    });
  }

  appendTransition(command: AppendReleaseRunTransition): StoredReleaseRunHead {
    this.#requireOpen();
    assertIdentifier(command.runId, "run ID");
    assertExpectedVersion(command.expectedVersion);
    if (command.events.length === 0) {
      throw new Error("A release transition requires at least one event.");
    }
    validateNextHead(command.nextHead);

    return this.#transaction(() => {
      const current = this.#requireHead(command.runId);
      if (current.version !== command.expectedVersion) {
        throw new ReleaseRunConcurrencyError(
          command.runId,
          command.expectedVersion,
        );
      }
      validateNewEventSequence(command.events, command.expectedVersion);
      const storedEvents = command.events.map((event) =>
        freeze({ ...event, runId: command.runId }),
      );
      const rebuilt = rebuildReleaseRunHead(command.runId, [
        ...this.#listEvents(command.runId),
        ...storedEvents,
      ]);
      assertNextHeadMatches(command.nextHead, rebuilt);

      for (const event of storedEvents) this.#insertEvent(event);
      this.#updateHeadFromRebuild(rebuilt, command.expectedVersion);
      return this.#requireHead(command.runId);
    });
  }

  recordDecision(command: RecordReleaseDecision): RecordReleaseDecisionResult {
    this.#requireOpen();
    validateDecisionCommand(command);
    const choice = parseDecisionChoice(command.choice);
    const scope = `release-decision:${command.decisionId}`;
    const request = decisionRequest(command, choice);

    return this.#transaction(() => {
      const existing = this.#readIdempotency(scope, command.idempotencyKey);
      if (existing) {
        this.#assertSameIdempotencyRequest(
          scope,
          command.idempotencyKey,
          request,
          existing.request_json,
        );
        return mapDecisionResponse(
          parseStoredJsonObject(existing.response_json, "decision response"),
          true,
        );
      }

      const run = this.#requireRun(command.runId);
      const head = this.#requireHead(command.runId);
      if (head.version !== command.expectedRunVersion) {
        throw new ReleaseRunConcurrencyError(
          command.runId,
          command.expectedRunVersion,
        );
      }
      if (
        head.state !== "AWAITING_DECISION" ||
        head.activeDecisionId !== command.decisionId
      ) {
        throw new ReleaseRunStateError(
          "Decision does not match the active run head.",
        );
      }
      if (run.candidateCommit !== command.candidateCommit) {
        throw new ReleaseRunStateError("Decision candidate is stale.");
      }
      if (head.nextWakeAt === null || head.nextWakeAt <= command.occurredAt) {
        throw new ReleaseRunStateError("Decision has expired.");
      }

      const events = buildDecisionEvents(command, choice, head.version);
      const rebuilt = rebuildReleaseRunHead(command.runId, [
        ...this.#listEvents(command.runId),
        ...events,
      ]);
      for (const event of events) this.#insertEvent(event);

      if (choice === "ESCALATE_INCIDENT") {
        this.#insertReservedAction(command, run);
      }
      this.#updateHeadFromRebuild(rebuilt, head.version);

      const response = freeze({
        runId: command.runId,
        decisionId: command.decisionId,
        choice,
        state: rebuilt.state,
        version: rebuilt.version,
        actionId: command.action?.actionId ?? null,
      });
      this.#insertIdempotency(
        scope,
        command.idempotencyKey,
        request,
        response,
        command.occurredAt,
      );
      return mapDecisionResponse(response, false);
    });
  }

  beginExternalAction(command: BeginExternalAction): StoredExternalAction {
    this.#requireOpen();
    assertIdentifier(command.actionId, "action ID");
    assertIdentifier(command.eventId, "event ID");
    assertExpectedVersion(command.expectedRunVersion);
    assertUtcTimestamp(command.occurredAt, "action attempt time");

    return this.#transaction(() => {
      const action = this.#requireAction(command.actionId);
      if (action.status !== "RESERVED" || action.attemptCount !== 0) {
        throw new ExternalActionAlreadyAttemptedError(command.actionId);
      }
      const head = this.#requireHead(action.runId);
      if (
        head.state !== "RESUMING" ||
        head.version !== command.expectedRunVersion
      ) {
        throw new ReleaseRunConcurrencyError(
          action.runId,
          command.expectedRunVersion,
        );
      }

      const event: StoredReleaseRunEvent = freeze({
        runId: action.runId,
        eventId: command.eventId,
        sequence: head.version + 1,
        eventType: "action-attempted",
        occurredAt: command.occurredAt,
        payload: freeze({
          actionId: command.actionId,
          actionType: action.actionType,
          attemptCount: 1,
        }),
      });
      const rebuilt = rebuildReleaseRunHead(action.runId, [
        ...this.#listEvents(action.runId),
        event,
      ]);
      this.#insertEvent(event);
      const actionUpdate = this.#database
        .prepare(
          `UPDATE external_actions
           SET status = 'IN_FLIGHT', attempt_count = 1, updated_at = ?
           WHERE action_id = ? AND status = 'RESERVED' AND attempt_count = 0`,
        )
        .run(command.occurredAt, command.actionId);
      if (Number(actionUpdate.changes) !== 1) {
        throw new ExternalActionAlreadyAttemptedError(command.actionId);
      }
      this.#updateHeadPreservingLease(rebuilt, head.version);
      return this.#requireAction(command.actionId);
    });
  }

  finishExternalAction(
    command: FinishExternalAction,
  ): FinishExternalActionResponse {
    this.#requireOpen();
    validateFinishCommand(command);
    const scope = `release-action:${command.actionId}`;
    const request = finishRequest(command);

    return this.#transaction(() => {
      const existing = this.#readIdempotency(scope, command.idempotencyKey);
      if (existing) {
        this.#assertSameIdempotencyRequest(
          scope,
          command.idempotencyKey,
          request,
          existing.request_json,
        );
        return mapFinishResponse(
          parseStoredJsonObject(existing.response_json, "action response"),
          true,
        );
      }

      const action = this.#requireAction(command.actionId);
      if (action.status !== "IN_FLIGHT" || action.attemptCount !== 1) {
        throw new ExternalActionAlreadyAttemptedError(command.actionId);
      }
      const head = this.#requireHead(action.runId);
      if (head.state !== "RESUMING") {
        throw new ReleaseRunStateError("Action run is not resuming.");
      }

      const projectedAction = parseExternalActionProjection({
        ...action,
        status: command.result.status,
        providerRecordId: command.result.providerRecordId,
        providerUrl: command.result.providerUrl,
        responseDigest: command.result.responseDigest,
        updatedAt: command.occurredAt,
      });
      const transition = actionTerminalTransition(
        command,
        action.runId,
        head.version,
      );
      const rebuilt = rebuildReleaseRunHead(action.runId, [
        ...this.#listEvents(action.runId),
        transition,
      ]);
      this.#insertEvent(transition);
      const actionUpdate = this.#database
        .prepare(
          `UPDATE external_actions
           SET status = ?, provider_record_id = ?, provider_url = ?,
               response_digest = ?, updated_at = ?
           WHERE action_id = ? AND status = 'IN_FLIGHT' AND attempt_count = 1`,
        )
        .run(
          projectedAction.status,
          projectedAction.providerRecordId,
          projectedAction.providerUrl,
          projectedAction.responseDigest,
          projectedAction.updatedAt,
          command.actionId,
        );
      if (Number(actionUpdate.changes) !== 1) {
        throw new ExternalActionAlreadyAttemptedError(command.actionId);
      }
      this.#updateHeadFromRebuild(rebuilt, head.version);

      const response = freeze({
        actionId: command.actionId,
        runId: action.runId,
        status: command.result.status,
        state: rebuilt.state,
        version: rebuilt.version,
      });
      this.#insertIdempotency(
        scope,
        command.idempotencyKey,
        request,
        response,
        command.occurredAt,
      );
      return mapFinishResponse(response, false);
    });
  }

  recoverAbandonedWork(now: string): RecoverAbandonedWorkResult {
    this.#requireOpen();
    assertUtcTimestamp(now, "recovery time");

    return this.#transaction(() => {
      const rows = this.#database
        .prepare(
          `SELECT a.action_id
           FROM external_actions a
           JOIN release_run_heads h ON h.run_id = a.run_id
           WHERE a.status = 'IN_FLIGHT'
             AND (h.lease_expires_at IS NULL OR h.lease_expires_at <= ?)
           ORDER BY a.action_id ASC`,
        )
        .all(now) as unknown as readonly { readonly action_id: string }[];
      const recoveredRunIds: string[] = [];

      for (const row of rows) {
        const action = this.#requireAction(row.action_id);
        const head = this.#requireHead(action.runId);
        const event: StoredReleaseRunEvent = freeze({
          runId: action.runId,
          eventId: recoveryEventId(action.actionId, head.version + 1),
          sequence: head.version + 1,
          eventType: "action-uncertain",
          occurredAt: now,
          payload: freeze({
            signal: "ACTION_UNCERTAIN",
            actionId: action.actionId,
            recovered: true,
            nextWakeAt: null,
            activeDecisionId: null,
            stopCode: "ACTION_OUTCOME_UNCERTAIN",
          }),
        });
        const rebuilt = rebuildReleaseRunHead(action.runId, [
          ...this.#listEvents(action.runId),
          event,
        ]);
        this.#insertEvent(event);
        const actionUpdate = this.#database
          .prepare(
            `UPDATE external_actions
             SET status = 'UNCERTAIN', response_digest = NULL, updated_at = ?
             WHERE action_id = ? AND status = 'IN_FLIGHT'`,
          )
          .run(now, action.actionId);
        if (Number(actionUpdate.changes) !== 1) {
          throw new ExternalActionAlreadyAttemptedError(action.actionId);
        }
        this.#updateHeadFromRebuild(rebuilt, head.version);
        recoveredRunIds.push(action.runId);
      }

      const cleared = this.#database
        .prepare(
          `UPDATE release_run_heads
           SET lease_owner = NULL, lease_expires_at = NULL
           WHERE lease_expires_at IS NOT NULL
             AND lease_expires_at <= ?
             AND state IN ('MONITORING', 'WAITING', 'AWAITING_DECISION', 'RESUMING')`,
        )
        .run(now);
      return freeze({
        clearedObservationLeases: Number(cleared.changes),
        uncertainActions: rows.length,
        recoveredRunIds: Object.freeze(recoveredRunIds),
      });
    });
  }

  rebuildHead(runId: string): StoredReleaseRunHead {
    this.#requireOpen();
    assertIdentifier(runId, "run ID");
    return this.#transaction(() => {
      this.#requireRun(runId);
      const current = this.#readHeadRow(runId);
      if (current?.lease_owner !== null && current?.lease_owner !== undefined) {
        throw new ReleaseRunStateError(
          "Cannot rebuild a release run head while it has a lease.",
        );
      }
      const rebuilt = rebuildReleaseRunHead(runId, this.#listEvents(runId));
      this.#database
        .prepare(
          `INSERT INTO release_run_heads(
            run_id, state, version, next_wake_at, active_decision_id,
            lease_owner, lease_expires_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
          ON CONFLICT(run_id) DO UPDATE SET
            state = excluded.state,
            version = excluded.version,
            next_wake_at = excluded.next_wake_at,
            active_decision_id = excluded.active_decision_id,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = excluded.updated_at`,
        )
        .run(
          rebuilt.runId,
          rebuilt.state,
          rebuilt.version,
          rebuilt.nextWakeAt,
          rebuilt.activeDecisionId,
          rebuilt.updatedAt,
        );
      return this.#requireHead(runId);
    });
  }

  getRun(runId: string): StoredReleaseRun | undefined {
    this.#requireOpen();
    const row = this.#readRunRow(runId);
    return row ? mapRun(row) : undefined;
  }

  getHead(runId: string): StoredReleaseRunHead | undefined {
    this.#requireOpen();
    const row = this.#readHeadRow(runId);
    return row ? mapHead(row) : undefined;
  }

  listEvents(runId: string): readonly StoredReleaseRunEvent[] {
    this.#requireOpen();
    return this.#listEvents(runId);
  }

  getExternalAction(actionId: string): StoredExternalAction | undefined {
    this.#requireOpen();
    const row = this.#readActionRow(actionId);
    return row ? mapAction(row) : undefined;
  }

  checkIntegrity(): string {
    this.#requireOpen();
    const row = this.#database.prepare("PRAGMA integrity_check").get() as
      { readonly integrity_check?: unknown } | undefined;
    if (typeof row?.integrity_check !== "string") {
      throw new Error("SQLite integrity check returned an invalid result.");
    }
    return row.integrity_check;
  }

  close(): void {
    if (this.#closed) return;
    this.#database.close();
    this.#closed = true;
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #insertEvent(event: StoredReleaseRunEvent): void {
    assertSafeJsonObject(event.payload, "release run event payload");
    this.#database
      .prepare(
        `INSERT INTO release_run_events(
          event_id, run_id, sequence, event_type, occurred_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.eventId,
        event.runId,
        event.sequence,
        event.eventType,
        event.occurredAt,
        canonicalJson(event.payload),
      );
  }

  #insertHead(head: RebuiltReleaseRunHead): void {
    this.#database
      .prepare(
        `INSERT INTO release_run_heads(
          run_id, state, version, next_wake_at, active_decision_id,
          lease_owner, lease_expires_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
      )
      .run(
        head.runId,
        head.state,
        head.version,
        head.nextWakeAt,
        head.activeDecisionId,
        head.updatedAt,
      );
  }

  #updateHeadFromRebuild(
    head: RebuiltReleaseRunHead,
    expectedVersion: number,
  ): void {
    const result = this.#database
      .prepare(
        `UPDATE release_run_heads
         SET state = ?, version = ?, next_wake_at = ?, active_decision_id = ?,
             lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE run_id = ? AND version = ?`,
      )
      .run(
        head.state,
        head.version,
        head.nextWakeAt,
        head.activeDecisionId,
        head.updatedAt,
        head.runId,
        expectedVersion,
      );
    if (Number(result.changes) !== 1) {
      throw new ReleaseRunConcurrencyError(head.runId, expectedVersion);
    }
  }

  #updateHeadPreservingLease(
    head: RebuiltReleaseRunHead,
    expectedVersion: number,
  ): void {
    const result = this.#database
      .prepare(
        `UPDATE release_run_heads
         SET state = ?, version = ?, next_wake_at = ?, active_decision_id = ?,
             updated_at = ?
         WHERE run_id = ? AND version = ?`,
      )
      .run(
        head.state,
        head.version,
        head.nextWakeAt,
        head.activeDecisionId,
        head.updatedAt,
        head.runId,
        expectedVersion,
      );
    if (Number(result.changes) !== 1) {
      throw new ReleaseRunConcurrencyError(head.runId, expectedVersion);
    }
  }

  #insertReservedAction(
    command: RecordReleaseDecision,
    run: StoredReleaseRun,
  ): void {
    const action = command.action;
    if (!action) throw new Error("Escalation requires an action reservation.");
    parseExternalActionProjection({
      actionId: action.actionId,
      runId: run.runId,
      actionType: "CREATE_GITHUB_INCIDENT",
      repository: run.repository,
      requestFingerprint: action.requestFingerprint,
      status: "RESERVED",
      attemptCount: 0,
      providerRecordId: null,
      providerUrl: null,
      responseDigest: null,
      createdAt: command.occurredAt,
      updatedAt: command.occurredAt,
    });
    this.#database
      .prepare(
        `INSERT INTO external_actions(
          action_id, run_id, action_type, request_fingerprint, status,
          attempt_count, provider_record_id, provider_url, response_digest,
          created_at, updated_at
        ) VALUES (?, ?, 'CREATE_GITHUB_INCIDENT', ?, 'RESERVED', 0, NULL, NULL, NULL, ?, ?)`,
      )
      .run(
        action.actionId,
        run.runId,
        action.requestFingerprint,
        command.occurredAt,
        command.occurredAt,
      );
  }

  #insertIdempotency(
    scope: string,
    key: string,
    request: JsonObject,
    response: JsonObject,
    createdAt: string,
  ): void {
    assertSafeJsonObject(request, "idempotency request");
    assertSafeJsonObject(response, "idempotency response");
    this.#database
      .prepare(
        `INSERT INTO idempotency_records(
          scope, key, request_json, response_json, created_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        scope,
        key,
        canonicalJson(request),
        canonicalJson(response),
        createdAt,
      );
  }

  #readIdempotency(scope: string, key: string): IdempotencyRow | undefined {
    return this.#database
      .prepare(
        `SELECT request_json, response_json
         FROM idempotency_records WHERE scope = ? AND key = ?`,
      )
      .get(scope, key) as IdempotencyRow | undefined;
  }

  #assertSameIdempotencyRequest(
    scope: string,
    key: string,
    request: JsonObject,
    storedRequest: string,
  ): void {
    if (canonicalJson(request) !== storedRequest) {
      throw new IdempotencyConflictError(scope, key);
    }
  }

  #listEvents(runId: string): readonly StoredReleaseRunEvent[] {
    const rows = this.#database
      .prepare(
        `SELECT event_id, run_id, sequence, event_type, occurred_at, payload_json
         FROM release_run_events WHERE run_id = ? ORDER BY sequence ASC`,
      )
      .all(runId) as unknown as readonly EventRow[];
    return Object.freeze(rows.map(mapEvent));
  }

  #readRunRow(runId: string): ReleaseRunRow | undefined {
    return this.#database
      .prepare(
        `SELECT run_id, repository, branch, candidate_commit,
                trigger_delivery_id, policy_profile_json, created_at
         FROM release_runs WHERE run_id = ?`,
      )
      .get(runId) as ReleaseRunRow | undefined;
  }

  #readHeadRow(runId: string): HeadRow | undefined {
    return this.#database
      .prepare(`SELECT ${HEAD_COLUMNS} FROM release_run_heads WHERE run_id = ?`)
      .get(runId) as HeadRow | undefined;
  }

  #readActionRow(actionId: string): ActionRow | undefined {
    return this.#database
      .prepare(
        `SELECT action_id, run_id, action_type, request_fingerprint, status,
                attempt_count, provider_record_id, provider_url, response_digest,
                created_at, updated_at
         FROM external_actions WHERE action_id = ?`,
      )
      .get(actionId) as ActionRow | undefined;
  }

  #requireRun(runId: string): StoredReleaseRun {
    const row = this.#readRunRow(runId);
    if (!row) throw new Error(`Unknown release run ${runId}.`);
    return mapRun(row);
  }

  #requireHead(runId: string): StoredReleaseRunHead {
    const row = this.#readHeadRow(runId);
    if (!row) throw new Error(`Missing release run head ${runId}.`);
    return mapHead(row);
  }

  #requireAction(actionId: string): StoredExternalAction {
    const row = this.#readActionRow(actionId);
    if (!row) throw new Error(`Unknown external action ${actionId}.`);
    return mapAction(row);
  }

  #requireOpen(): void {
    if (this.#closed) throw new Error("SQLite release run ledger is closed.");
  }
}

const HEAD_COLUMNS = `
  run_id, state, version, next_wake_at, active_decision_id,
  lease_owner, lease_expires_at, updated_at
`;

function validateTrigger(trigger: CreateRunFromWebhook): void {
  assertIdentifier(trigger.runId, "run ID");
  assertIdentifier(trigger.triggerEventId, "trigger event ID");
  assertIdentifier(trigger.triggerDeliveryId, "trigger delivery ID");
  assertUtcTimestamp(trigger.createdAt, "run creation time");
  if (
    trigger.repository !== "YongHwan2161/quietops" ||
    trigger.branch !== "main" ||
    !COMMIT_PATTERN.test(trigger.candidateCommit)
  ) {
    throw new Error("Webhook trigger is outside the fixed release target.");
  }
}

function validateNewEventSequence(
  events: readonly NewReleaseRunEvent[],
  expectedVersion: number,
): void {
  events.forEach((event, index) => {
    if (event.sequence !== expectedVersion + index + 1) {
      throw new Error("New release run events must be contiguous.");
    }
  });
}

function validateNextHead(head: NextReleaseRunHead): void {
  assertUtcTimestamp(head.updatedAt, "next head update time");
  if (head.nextWakeAt !== null) {
    assertUtcTimestamp(head.nextWakeAt, "next head wake time");
  }
  if (head.activeDecisionId !== null) {
    assertIdentifier(head.activeDecisionId, "active decision ID");
  }
}

function assertNextHeadMatches(
  expected: NextReleaseRunHead,
  rebuilt: RebuiltReleaseRunHead,
): void {
  if (
    expected.state !== rebuilt.state ||
    expected.nextWakeAt !== rebuilt.nextWakeAt ||
    expected.activeDecisionId !== rebuilt.activeDecisionId ||
    expected.updatedAt !== rebuilt.updatedAt
  ) {
    throw new Error(
      "Requested head does not match the append-only event projection.",
    );
  }
}

function validateDecisionCommand(command: RecordReleaseDecision): void {
  assertIdentifier(command.decisionId, "decision ID");
  assertIdentifier(command.runId, "run ID");
  assertIdentifier(command.idempotencyKey, "decision idempotency key");
  assertIdentifier(command.eventId, "decision event ID");
  assertExpectedVersion(command.expectedRunVersion);
  assertUtcTimestamp(command.occurredAt, "decision time");
  if (!COMMIT_PATTERN.test(command.candidateCommit)) {
    throw new Error("Invalid decision candidate commit.");
  }
  if (command.choice === "WAIT_AND_RECHECK") {
    if (command.waitUntil === null || command.waitUntil <= command.occurredAt) {
      throw new Error("Wait decision requires a future wake time.");
    }
    assertUtcTimestamp(command.waitUntil, "decision wake time");
    if (command.action !== null || command.actionEventId !== null) {
      throw new Error("Wait decision cannot reserve an external action.");
    }
  } else if (command.choice === "ESCALATE_INCIDENT") {
    if (command.waitUntil !== null || command.action === null) {
      throw new Error(
        "Escalation decision requires exactly one action reservation.",
      );
    }
    if (command.actionEventId === null) {
      throw new Error("Escalation decision requires an action event ID.");
    }
    assertIdentifier(command.actionEventId, "action reservation event ID");
    if (command.actionEventId === command.eventId) {
      throw new Error("Decision and action reservation event IDs must differ.");
    }
    assertIdentifier(command.action.actionId, "action ID");
    if (!FINGERPRINT_PATTERN.test(command.action.requestFingerprint)) {
      throw new Error("Invalid external action request fingerprint.");
    }
  }
}

function validateFinishCommand(command: FinishExternalAction): void {
  assertIdentifier(command.actionId, "action ID");
  assertIdentifier(command.idempotencyKey, "action idempotency key");
  assertIdentifier(command.eventId, "action result event ID");
  assertUtcTimestamp(command.occurredAt, "action result time");
  if (
    command.result.responseDigest !== null &&
    !FINGERPRINT_PATTERN.test(command.result.responseDigest)
  ) {
    throw new Error("Invalid external action response digest.");
  }
}

function assertExpectedVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("Expected run version must be a positive safe integer.");
  }
}

function buildDecisionEvents(
  command: RecordReleaseDecision,
  choice: DecisionChoice,
  version: number,
): readonly StoredReleaseRunEvent[] {
  const decisionEvent: StoredReleaseRunEvent = freeze({
    runId: command.runId,
    eventId: command.eventId,
    sequence: version + 1,
    eventType: "decision-recorded",
    occurredAt: command.occurredAt,
    payload: freeze({
      signal:
        choice === "WAIT_AND_RECHECK"
          ? "WAIT_AND_RECHECK_AUTHORIZED"
          : "ESCALATE_INCIDENT_AUTHORIZED",
      decisionId: command.decisionId,
      choice,
      nextWakeAt: command.waitUntil,
      activeDecisionId: null,
      stopCode: null,
    }),
  });
  if (choice === "WAIT_AND_RECHECK") return Object.freeze([decisionEvent]);

  const action = command.action!;
  const actionEvent: StoredReleaseRunEvent = freeze({
    runId: command.runId,
    eventId: command.actionEventId!,
    sequence: version + 2,
    eventType: "action-reserved",
    occurredAt: command.occurredAt,
    payload: freeze({
      actionId: action.actionId,
      actionType: "CREATE_GITHUB_INCIDENT",
      requestFingerprint: action.requestFingerprint,
    }),
  });
  return Object.freeze([decisionEvent, actionEvent]);
}

function actionTerminalTransition(
  command: FinishExternalAction,
  runId: string,
  version: number,
): StoredReleaseRunEvent {
  const configuration =
    command.result.status === "CONFIRMED"
      ? {
          eventType: "action-confirmed" as const,
          signal: "ACTION_CONFIRMED" as const,
          stopCode: null,
        }
      : command.result.status === "REJECTED"
        ? {
            eventType: "action-rejected" as const,
            signal: "ACTION_REJECTED" as const,
            stopCode: "ACTION_REJECTED" as const,
          }
        : {
            eventType: "action-uncertain" as const,
            signal: "ACTION_UNCERTAIN" as const,
            stopCode: "ACTION_OUTCOME_UNCERTAIN" as const,
          };
  return freeze({
    runId,
    eventId: command.eventId,
    sequence: version + 1,
    eventType: configuration.eventType,
    occurredAt: command.occurredAt,
    payload: freeze({
      signal: configuration.signal,
      actionId: command.actionId,
      status: command.result.status,
      providerRecordId: command.result.providerRecordId,
      providerUrl: command.result.providerUrl,
      responseDigest: command.result.responseDigest,
      nextWakeAt: null,
      activeDecisionId: null,
      stopCode: configuration.stopCode,
    }),
  });
}

function triggerRequest(
  trigger: CreateRunFromWebhook,
  profile: PolicyProfile,
): JsonObject {
  return freeze({
    repository: trigger.repository,
    branch: trigger.branch,
    candidateCommit: trigger.candidateCommit,
    triggerDeliveryId: trigger.triggerDeliveryId,
    policyProfile: policyProfileToJson(profile),
  });
}

function policyProfileToJson(profile: PolicyProfile): JsonObject {
  return freeze({
    name: profile.name,
    version: profile.version,
    normalDeploymentObservations: profile.normalDeploymentObservations,
    delayBetweenObservationsMs: profile.delayBetweenObservationsMs,
    humanDecisionTtlMs: profile.humanDecisionTtlMs,
    authorizedExtensionMs: profile.authorizedExtensionMs,
    maxHumanDecisions: profile.maxHumanDecisions,
    maxIncidentWriteAttempts: profile.maxIncidentWriteAttempts,
    providerTimeoutMs: profile.providerTimeoutMs,
  });
}

function decisionRequest(
  command: RecordReleaseDecision,
  choice: DecisionChoice,
): JsonObject {
  return freeze({
    decisionId: command.decisionId,
    runId: command.runId,
    candidateCommit: command.candidateCommit,
    expectedRunVersion: command.expectedRunVersion,
    choice,
    waitUntil: command.waitUntil,
    action:
      command.action === null
        ? null
        : freeze({
            actionId: command.action.actionId,
            requestFingerprint: command.action.requestFingerprint,
          }),
  });
}

function finishRequest(command: FinishExternalAction): JsonObject {
  return freeze({
    actionId: command.actionId,
    result: freeze({
      status: command.result.status,
      providerRecordId: command.result.providerRecordId,
      providerUrl: command.result.providerUrl,
      responseDigest: command.result.responseDigest,
    }),
  });
}

function mapRun(row: ReleaseRunRow): StoredReleaseRun {
  const profile = parsePolicyProfile(
    parseStoredJsonObject(row.policy_profile_json, "release policy profile"),
  );
  if (
    row.repository !== "YongHwan2161/quietops" ||
    row.branch !== "main" ||
    !COMMIT_PATTERN.test(row.candidate_commit)
  ) {
    throw new Error("Stored release run violates the fixed target contract.");
  }
  return freeze({
    runId: row.run_id,
    repository: row.repository,
    branch: row.branch,
    candidateCommit: row.candidate_commit,
    triggerDeliveryId: row.trigger_delivery_id,
    policyProfile: profile,
    createdAt: row.created_at,
  });
}

function mapHead(row: HeadRow): StoredReleaseRunHead {
  return freeze({
    runId: row.run_id,
    state: row.state as ReleaseRunState,
    version: row.version,
    nextWakeAt: row.next_wake_at,
    activeDecisionId: row.active_decision_id,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    updatedAt: row.updated_at,
  });
}

function mapRebuiltHead(head: RebuiltReleaseRunHead): StoredReleaseRunHead {
  return freeze({ ...head });
}

function mapEvent(row: EventRow): StoredReleaseRunEvent {
  return freeze({
    eventId: row.event_id,
    runId: row.run_id,
    sequence: row.sequence,
    eventType: row.event_type as StoredReleaseRunEvent["eventType"],
    occurredAt: row.occurred_at,
    payload: parseStoredJsonObject(
      row.payload_json,
      "release run event payload",
    ),
  });
}

function mapAction(row: ActionRow): StoredExternalAction {
  return parseExternalActionProjection({
    actionId: row.action_id,
    runId: row.run_id,
    actionType: row.action_type,
    repository: "YongHwan2161/quietops",
    requestFingerprint: row.request_fingerprint,
    status: row.status,
    attemptCount: row.attempt_count,
    providerRecordId: row.provider_record_id,
    providerUrl: row.provider_url,
    responseDigest: row.response_digest,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapDecisionResponse(
  response: JsonObject,
  replayed: boolean,
): RecordReleaseDecisionResult {
  const choice = parseDecisionChoice(response.choice);
  const state = requireString(response.state, "decision response state");
  if (state !== "WAITING" && state !== "RESUMING") {
    throw new Error("Stored decision response has an invalid state.");
  }
  return freeze({
    runId: requireString(response.runId, "decision response run ID"),
    decisionId: requireString(response.decisionId, "decision response ID"),
    choice,
    state,
    version: requirePositiveInteger(
      response.version,
      "decision response version",
    ),
    actionId: requireNullableString(
      response.actionId,
      "decision response action ID",
    ),
    replayed,
  });
}

function mapFinishResponse(
  response: JsonObject,
  replayed: boolean,
): FinishExternalActionResponse {
  const status = requireString(response.status, "action response status");
  const state = requireString(response.state, "action response state");
  if (
    !["CONFIRMED", "REJECTED", "UNCERTAIN"].includes(status) ||
    !["ESCALATED", "STOPPED"].includes(state)
  ) {
    throw new Error("Stored action response has invalid terminal values.");
  }
  return freeze({
    actionId: requireString(response.actionId, "action response ID"),
    runId: requireString(response.runId, "action response run ID"),
    status: status as FinishExternalActionResponse["status"],
    state: state as FinishExternalActionResponse["state"],
    version: requirePositiveInteger(
      response.version,
      "action response version",
    ),
    replayed,
  });
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Invalid ${label}.`);
  return value;
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireString(value, label);
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function recoveryEventId(actionId: string, sequence: number): string {
  const digest = createHash("sha256")
    .update(actionId)
    .digest("hex")
    .slice(0, 40);
  return `recovery:${digest}:${sequence}`;
}

function freeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}
