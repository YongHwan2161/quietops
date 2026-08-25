import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { resolvePolicyProfile } from "@quietops/contracts";

import {
  ExternalActionAlreadyAttemptedError,
  IdempotencyConflictError,
  ReleaseRunConcurrencyError,
  SQLiteEvaluationLedger,
  SQLiteReleaseRunLedger,
  applySQLiteMigrations,
  type CreateRunFromWebhook,
  type RecordReleaseDecision,
} from "../src/index.js";

const COMMIT = "23f1d3d04cea0e856172c3e436b5e3742e844b80";
const OTHER_COMMIT = "f2aa8b1593c96c00b4737def5085b4d3380bda90";
const REQUEST_FINGERPRINT =
  "3b34fdd5f684497414b23488202d068638b9661821e2a5f81ec24f25c8b9c1bd";
const RESPONSE_DIGEST =
  "54bb5d958bdd858e953a4b0a98b7881c7f20c94b7bc31797278b09a0f50b295c";

test("creates the exact ordered v2 schema on a fresh database", () => {
  const fixture = createFixture("fresh-schema");
  const ledger = new SQLiteReleaseRunLedger(fixture.path);
  try {
    assert.equal(ledger.checkIntegrity(), "ok");
    assert.equal(ledger.getMigrationVersion(), 2);
  } finally {
    ledger.close();
  }

  const database = new DatabaseSync(fixture.path);
  try {
    assert.deepEqual(readMigrationVersions(database), [1, 2]);
    assert.deepEqual(schemaNames(database, "table"), [
      "evaluation_events",
      "evaluations",
      "external_actions",
      "idempotency_records",
      "release_run_events",
      "release_run_heads",
      "release_runs",
      "schema_migrations",
    ]);
    assert.deepEqual(schemaNames(database, "index", true), [
      "one_human_decision_per_evaluation",
      "one_release_decision_record",
      "one_release_decision_request",
      "release_run_heads_due",
    ]);
    assert.equal(schemaNames(database, "trigger").length, 12);
  } finally {
    database.close();
    fixture.remove();
  }
});

test("upgrades populated v1 data without changing legacy row bytes or behavior", () => {
  const fixture = createFixture("v1-upgrade");
  const database = new DatabaseSync(fixture.path);
  let beforeHash = "";
  try {
    applySQLiteMigrations(database, {
      targetVersion: 1,
      appliedAt: "2026-08-23T12:00:00.000Z",
    });
    insertLegacyFixture(database);
    beforeHash = hashLegacyRows(database);
    assert.deepEqual(readMigrationVersions(database), [1]);
  } finally {
    database.close();
  }

  const releaseLedger = new SQLiteReleaseRunLedger(fixture.path);
  try {
    assert.equal(releaseLedger.checkIntegrity(), "ok");
  } finally {
    releaseLedger.close();
  }

  const upgraded = new DatabaseSync(fixture.path);
  try {
    assert.deepEqual(readMigrationVersions(upgraded), [1, 2]);
    assert.equal(hashLegacyRows(upgraded), beforeHash);
    assert.equal(countRows(upgraded, "evaluations"), 1);
    assert.equal(countRows(upgraded, "evaluation_events"), 1);
    assert.equal(countRows(upgraded, "idempotency_records"), 1);
  } finally {
    upgraded.close();
  }

  const legacyLedger = new SQLiteEvaluationLedger(fixture.path);
  try {
    assert.equal(
      legacyLedger.getEvaluation("legacy-evaluation")?.scenario,
      "ready",
    );
    assert.equal(legacyLedger.listEvents("legacy-evaluation").length, 1);
    assert.equal(legacyLedger.checkIntegrity(), "ok");
  } finally {
    legacyLedger.close();
    fixture.remove();
  }
});

test("rolls back a failed migration without recording a partial v2", () => {
  const database = new DatabaseSync(":memory:");
  try {
    applySQLiteMigrations(database, {
      targetVersion: 1,
      appliedAt: "2026-08-23T12:00:00.000Z",
    });
    database.exec(
      "CREATE TABLE release_run_events(conflicting_column TEXT) STRICT;",
    );

    assert.throws(
      () =>
        applySQLiteMigrations(database, {
          targetVersion: 2,
          appliedAt: "2026-08-23T12:01:00.000Z",
        }),
      /run_id|no such column/i,
    );
    assert.deepEqual(readMigrationVersions(database), [1]);
    assert.equal(hasSchemaObject(database, "table", "release_runs"), false);
    assert.equal(
      hasSchemaObject(database, "table", "release_run_heads"),
      false,
    );
    assert.equal(hasSchemaObject(database, "table", "external_actions"), false);
    assert.equal(
      hasSchemaObject(database, "table", "release_run_events"),
      true,
    );
  } finally {
    database.close();
  }
});

test("creates and replays one webhook run while preserving immutable audit truth", () => {
  const fixture = createFixture("trigger-replay");
  const ledger = new SQLiteReleaseRunLedger(fixture.path);
  try {
    const first = ledger.createRunFromWebhook(trigger());
    assert.equal(first.replayed, false);
    assert.deepEqual(first.head, {
      runId: "run-01",
      state: "MONITORING",
      version: 1,
      nextWakeAt: null,
      activeDecisionId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: "2026-08-23T12:00:00.000Z",
    });

    const replay = ledger.createRunFromWebhook(
      trigger({
        runId: "ignored-replay-id",
        triggerEventId: "ignored-event-id",
      }),
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.runId, "run-01");
    assert.equal(ledger.listEvents("run-01").length, 1);

    assert.throws(
      () =>
        ledger.createRunFromWebhook(
          trigger({ runId: "run-conflict", candidateCommit: OTHER_COMMIT }),
        ),
      IdempotencyConflictError,
    );
  } finally {
    ledger.close();
  }

  const database = new DatabaseSync(fixture.path);
  try {
    assert.throws(
      () =>
        database
          .prepare(
            "UPDATE release_runs SET branch = 'other' WHERE run_id = 'run-01'",
          )
          .run(),
      /release runs are immutable/,
    );
    assert.throws(
      () =>
        database
          .prepare("DELETE FROM release_run_events WHERE run_id = 'run-01'")
          .run(),
      /release run events are append-only/,
    );
    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO release_run_events(
              event_id, run_id, sequence, event_type, occurred_at, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "gap-event",
            "run-01",
            3,
            "observation-recorded",
            "2026-08-23T12:00:01.000Z",
            "{}",
          ),
      /sequence must be contiguous/,
    );
    assert.equal(countRows(database, "release_runs"), 1);
    assert.equal(countRows(database, "release_run_events"), 1);
  } finally {
    database.close();
    fixture.remove();
  }
});

test("lists newest runs while keeping preserved demonstrations outside worker claims", () => {
  const ledger = new SQLiteReleaseRunLedger();
  try {
    ledger.createRunFromWebhook(
      trigger({
        runId: "live-run",
        triggerEventId: "live-event",
        triggerDeliveryId: "live-delivery",
        createdAt: "2026-08-23T12:00:00.000Z",
      }),
    );
    ledger.createRunFromWebhook(
      trigger({
        runId: "preserved-run",
        triggerEventId: "preserved-event",
        triggerDeliveryId: "preserved-demo:browser",
        createdAt: "2026-08-23T12:00:01.000Z",
      }),
    );

    assert.deepEqual(
      ledger.listRuns().map((run) => run.runId),
      ["preserved-run", "live-run"],
    );
    assert.deepEqual(
      ledger.listRuns(1).map((run) => run.runId),
      ["preserved-run"],
    );
    assert.throws(() => ledger.listRuns(0), /integer from 1 through 100/);

    const claim = ledger.claimNextDueRun(
      "worker-live-only",
      "2026-08-23T12:00:02.000Z",
      1_000,
    );
    assert.equal(claim?.runId, "live-run");
    assert.equal(ledger.getHead("preserved-run")?.leaseOwner, null);
  } finally {
    ledger.close();
  }
});

test("commits events and heads with CAS, rolls back conflicts, and rebuilds a deleted head", () => {
  const fixture = createFixture("cas-rebuild");
  let ledger = new SQLiteReleaseRunLedger(fixture.path);
  try {
    ledger.createRunFromWebhook(trigger());
    const waiting = ledger.appendTransition({
      runId: "run-01",
      expectedVersion: 1,
      events: [waitEvent(2)],
      nextHead: {
        state: "WAITING",
        nextWakeAt: "2026-08-23T12:00:05.000Z",
        activeDecisionId: null,
        updatedAt: "2026-08-23T12:00:01.000Z",
      },
    });
    assert.equal(waiting.version, 2);

    assert.throws(
      () =>
        ledger.appendTransition({
          runId: "run-01",
          expectedVersion: 1,
          events: [wakeEvent(2)],
          nextHead: monitoringHead("2026-08-23T12:00:06.000Z"),
        }),
      ReleaseRunConcurrencyError,
    );
    assert.throws(
      () =>
        ledger.appendTransition({
          runId: "run-01",
          expectedVersion: 2,
          events: [wakeEvent(3)],
          nextHead: {
            state: "WAITING",
            nextWakeAt: "2026-08-23T12:00:07.000Z",
            activeDecisionId: null,
            updatedAt: "2026-08-23T12:00:06.000Z",
          },
        }),
      /does not match the append-only event projection/,
    );
    assert.equal(ledger.listEvents("run-01").length, 2);
    assert.equal(ledger.getHead("run-01")?.version, 2);

    const monitoring = ledger.appendTransition({
      runId: "run-01",
      expectedVersion: 2,
      events: [wakeEvent(3)],
      nextHead: monitoringHead("2026-08-23T12:00:06.000Z"),
    });
    assert.equal(monitoring.state, "MONITORING");
    assert.equal(monitoring.version, 3);
  } finally {
    ledger.close();
  }

  const database = new DatabaseSync(fixture.path);
  try {
    database
      .prepare("DELETE FROM release_run_heads WHERE run_id = ?")
      .run("run-01");
  } finally {
    database.close();
  }

  ledger = new SQLiteReleaseRunLedger(fixture.path);
  try {
    assert.equal(ledger.getHead("run-01"), undefined);
    assert.deepEqual(ledger.rebuildHead("run-01"), {
      runId: "run-01",
      state: "MONITORING",
      version: 3,
      nextWakeAt: null,
      activeDecisionId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: "2026-08-23T12:00:06.000Z",
    });
    assert.equal(ledger.checkIntegrity(), "ok");
  } finally {
    ledger.close();
    fixture.remove();
  }
});

test("gives one of two ledgers the due lease and recovers the expired observation lease", () => {
  const fixture = createFixture("lease-race");
  const first = new SQLiteReleaseRunLedger(fixture.path);
  const second = new SQLiteReleaseRunLedger(fixture.path);
  try {
    first.createRunFromWebhook(trigger());
    const claims = [
      first.claimNextDueRun("worker-1", "2026-08-23T12:00:01.000Z", 1_000),
      second.claimNextDueRun("worker-2", "2026-08-23T12:00:01.000Z", 1_000),
    ].filter((claim) => claim !== undefined);
    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.leaseOwner, "worker-1");
    assert.throws(() => first.rebuildHead("run-01"), /while it has a lease/);
  } finally {
    first.close();
    second.close();
  }

  const recovered = new SQLiteReleaseRunLedger(fixture.path);
  try {
    assert.deepEqual(
      recovered.recoverAbandonedWork("2026-08-23T12:00:02.000Z"),
      {
        clearedObservationLeases: 1,
        uncertainActions: 0,
        recoveredRunIds: [],
      },
    );
    assert.equal(recovered.getHead("run-01")?.leaseOwner, null);
    assert.equal(recovered.listEvents("run-01").length, 1);
    assert.equal(
      recovered.recoverAbandonedWork("2026-08-23T12:00:03.000Z")
        .clearedObservationLeases,
      0,
    );
  } finally {
    recovered.close();
    fixture.remove();
  }
});

test("records one wait decision, replays it, and rejects conflicting or second decisions", () => {
  const ledger = new SQLiteReleaseRunLedger();
  try {
    ledger.createRunFromWebhook(trigger());
    requestDecision(ledger);
    const command = waitDecision();
    assert.equal(
      ledger.findDecisionRequest("decision-01")?.eventType,
      "decision-requested",
    );
    assert.equal(ledger.findDecisionRequest("unknown-decision"), undefined);
    const first = ledger.recordDecision(command);
    assert.deepEqual(first, {
      runId: "run-01",
      decisionId: "decision-01",
      choice: "WAIT_AND_RECHECK",
      state: "WAITING",
      version: 3,
      actionId: null,
      replayed: false,
    });
    assert.equal(ledger.recordDecision(command).replayed, true);
    assert.equal(ledger.listEvents("run-01").length, 3);
    assert.equal(
      ledger.listEvents("run-01").at(-1)?.payload.actor,
      "release-owner",
    );
    assert.equal(ledger.getExternalAction("action-01"), undefined);

    assert.throws(
      () =>
        ledger.recordDecision(
          escalateDecision({ idempotencyKey: "decision-key" }),
        ),
      IdempotencyConflictError,
    );
    assert.throws(
      () => ledger.recordDecision({ ...command, idempotencyKey: "second-key" }),
      ReleaseRunConcurrencyError,
    );
    assert.equal(
      ledger
        .listEvents("run-01")
        .filter((event) => event.eventType === "decision-recorded").length,
      1,
    );
  } finally {
    ledger.close();
  }
});

test("reserves one incident action, permits one attempt, and replays one confirmed finish", () => {
  const ledger = new SQLiteReleaseRunLedger();
  try {
    ledger.createRunFromWebhook(trigger());
    requestDecision(ledger);
    const decision = ledger.recordDecision(escalateDecision());
    assert.equal(decision.state, "RESUMING");
    assert.equal(decision.version, 4);
    assert.deepEqual(ledger.getExternalAction("action-01"), {
      actionId: "action-01",
      runId: "run-01",
      actionType: "CREATE_GITHUB_INCIDENT",
      repository: "YongHwan2161/quietops",
      requestFingerprint: REQUEST_FINGERPRINT,
      status: "RESERVED",
      attemptCount: 0,
      providerRecordId: null,
      providerUrl: null,
      responseDigest: null,
      createdAt: "2026-08-23T12:01:00.000Z",
      updatedAt: "2026-08-23T12:01:00.000Z",
    });

    const inFlight = ledger.beginExternalAction({
      actionId: "action-01",
      expectedRunVersion: 4,
      eventId: "event-action-attempted",
      occurredAt: "2026-08-23T12:01:01.000Z",
    });
    assert.equal(inFlight.status, "IN_FLIGHT");
    assert.equal(inFlight.attemptCount, 1);
    assert.throws(
      () =>
        ledger.beginExternalAction({
          actionId: "action-01",
          expectedRunVersion: 5,
          eventId: "event-action-attempted-again",
          occurredAt: "2026-08-23T12:01:02.000Z",
        }),
      ExternalActionAlreadyAttemptedError,
    );

    const finish = confirmedFinish();
    assert.deepEqual(ledger.finishExternalAction(finish), {
      actionId: "action-01",
      runId: "run-01",
      status: "CONFIRMED",
      state: "ESCALATED",
      version: 6,
      replayed: false,
    });
    assert.equal(ledger.finishExternalAction(finish).replayed, true);
    assert.equal(ledger.listEvents("run-01").length, 6);
    assert.equal(ledger.getExternalAction("action-01")?.attemptCount, 1);
    assert.equal(
      ledger.getExternalAction("action-01")?.providerRecordId,
      "123",
    );

    assert.throws(
      () =>
        ledger.finishExternalAction({
          ...finish,
          result: {
            status: "REJECTED",
            providerRecordId: null,
            providerUrl: null,
            responseDigest: RESPONSE_DIGEST,
          },
        }),
      IdempotencyConflictError,
    );
  } finally {
    ledger.close();
  }
});

test("recovers an abandoned in-flight action as terminal uncertain and never retries it", () => {
  const fixture = createFixture("action-recovery");
  let ledger = new SQLiteReleaseRunLedger(fixture.path);
  try {
    ledger.createRunFromWebhook(trigger());
    requestDecision(ledger);
    ledger.recordDecision(escalateDecision());
    assert.equal(
      ledger.claimNextDueRun("worker-action", "2026-08-23T12:01:00.500Z", 1_000)
        ?.runId,
      "run-01",
    );
    ledger.beginExternalAction({
      actionId: "action-01",
      expectedRunVersion: 4,
      eventId: "event-action-attempted",
      occurredAt: "2026-08-23T12:01:01.000Z",
    });
  } finally {
    ledger.close();
  }

  ledger = new SQLiteReleaseRunLedger(fixture.path);
  try {
    assert.deepEqual(ledger.recoverAbandonedWork("2026-08-23T12:01:02.000Z"), {
      clearedObservationLeases: 0,
      uncertainActions: 1,
      recoveredRunIds: ["run-01"],
    });
    assert.equal(ledger.getExternalAction("action-01")?.status, "UNCERTAIN");
    assert.equal(ledger.getExternalAction("action-01")?.attemptCount, 1);
    assert.equal(ledger.getHead("run-01")?.state, "STOPPED");
    assert.equal(ledger.getHead("run-01")?.version, 6);
    assert.equal(
      ledger.listEvents("run-01").at(-1)?.eventType,
      "action-uncertain",
    );
    assert.equal(
      ledger.recoverAbandonedWork("2026-08-23T12:01:03.000Z").uncertainActions,
      0,
    );
    assert.throws(
      () =>
        ledger.beginExternalAction({
          actionId: "action-01",
          expectedRunVersion: 6,
          eventId: "forbidden-retry",
          occurredAt: "2026-08-23T12:01:04.000Z",
        }),
      ExternalActionAlreadyAttemptedError,
    );
    assert.deepEqual(ledger.rebuildHead("run-01"), ledger.getHead("run-01"));
    assert.equal(ledger.checkIntegrity(), "ok");
  } finally {
    ledger.close();
  }

  ledger = new SQLiteReleaseRunLedger(fixture.path);
  try {
    assert.equal(ledger.getExternalAction("action-01")?.status, "UNCERTAIN");
    assert.equal(ledger.getExternalAction("action-01")?.attemptCount, 1);
  } finally {
    ledger.close();
    fixture.remove();
  }
});

function trigger(
  overrides: Partial<CreateRunFromWebhook> = {},
): CreateRunFromWebhook {
  return {
    runId: "run-01",
    triggerEventId: "event-triggered",
    repository: "YongHwan2161/quietops",
    branch: "main",
    candidateCommit: COMMIT,
    triggerDeliveryId: "delivery-01",
    policyProfile: resolvePolicyProfile("demo-v1"),
    createdAt: "2026-08-23T12:00:00.000Z",
    ...overrides,
  };
}

function waitEvent(sequence: number) {
  return {
    eventId: `event-wait-${sequence}`,
    sequence,
    eventType: "wait-scheduled" as const,
    occurredAt: "2026-08-23T12:00:01.000Z",
    payload: {
      signal: "NORMAL_WAIT_REQUIRED",
      nextWakeAt: "2026-08-23T12:00:05.000Z",
      activeDecisionId: null,
      stopCode: null,
    },
  };
}

function wakeEvent(sequence: number) {
  return {
    eventId: `event-wake-${sequence}`,
    sequence,
    eventType: "run-woke" as const,
    occurredAt: "2026-08-23T12:00:06.000Z",
    payload: {
      signal: "WAIT_DUE",
      nextWakeAt: null,
      activeDecisionId: null,
      stopCode: null,
    },
  };
}

function monitoringHead(updatedAt: string) {
  return {
    state: "MONITORING" as const,
    nextWakeAt: null,
    activeDecisionId: null,
    updatedAt,
  };
}

function requestDecision(ledger: SQLiteReleaseRunLedger): void {
  ledger.appendTransition({
    runId: "run-01",
    expectedVersion: 1,
    events: [
      {
        eventId: "event-decision-requested",
        sequence: 2,
        eventType: "decision-requested",
        occurredAt: "2026-08-23T12:00:30.000Z",
        payload: {
          signal: "OBSERVATION_BUDGET_EXHAUSTED",
          decisionId: "decision-01",
          nextWakeAt: "2026-08-23T12:15:30.000Z",
          activeDecisionId: "decision-01",
          stopCode: null,
        },
      },
    ],
    nextHead: {
      state: "AWAITING_DECISION",
      nextWakeAt: "2026-08-23T12:15:30.000Z",
      activeDecisionId: "decision-01",
      updatedAt: "2026-08-23T12:00:30.000Z",
    },
  });
}

function waitDecision(
  overrides: Partial<RecordReleaseDecision> = {},
): RecordReleaseDecision {
  return {
    decisionId: "decision-01",
    runId: "run-01",
    candidateCommit: COMMIT,
    expectedRunVersion: 2,
    idempotencyKey: "decision-key",
    eventId: "event-decision-recorded",
    actionEventId: null,
    choice: "WAIT_AND_RECHECK",
    actor: "release-owner",
    occurredAt: "2026-08-23T12:01:00.000Z",
    waitUntil: "2026-08-23T12:01:05.000Z",
    action: null,
    ...overrides,
  };
}

function escalateDecision(
  overrides: Partial<RecordReleaseDecision> = {},
): RecordReleaseDecision {
  return {
    decisionId: "decision-01",
    runId: "run-01",
    candidateCommit: COMMIT,
    expectedRunVersion: 2,
    idempotencyKey: "escalate-key",
    eventId: "event-decision-recorded",
    actionEventId: "event-action-reserved",
    choice: "ESCALATE_INCIDENT",
    actor: "release-owner",
    occurredAt: "2026-08-23T12:01:00.000Z",
    waitUntil: null,
    action: {
      actionId: "action-01",
      requestFingerprint: REQUEST_FINGERPRINT,
    },
    ...overrides,
  };
}

function confirmedFinish() {
  return {
    actionId: "action-01",
    idempotencyKey: "action-result-key",
    eventId: "event-action-confirmed",
    occurredAt: "2026-08-23T12:01:02.000Z",
    result: {
      status: "CONFIRMED" as const,
      providerRecordId: "123",
      providerUrl: "https://github.com/YongHwan2161/quietops/issues/123",
      responseDigest: RESPONSE_DIGEST,
    },
  };
}

function createFixture(label: string) {
  const directory = mkdtempSync(join(tmpdir(), `quietops-${label}-`));
  return {
    path: join(directory, "ledger.sqlite"),
    remove: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function insertLegacyFixture(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO evaluations(
        evaluation_id, scenario, candidate_json, parent_evaluation_id, created_at
      ) VALUES (?, ?, ?, NULL, ?)`,
    )
    .run(
      "legacy-evaluation",
      "ready",
      JSON.stringify({ commit: COMMIT }),
      "2026-08-23T12:00:00.000Z",
    );
  database
    .prepare(
      `INSERT INTO evaluation_events(
        event_id, evaluation_id, sequence, event_type, occurred_at, payload_json
      ) VALUES (?, ?, 1, ?, ?, ?)`,
    )
    .run(
      "legacy-event",
      "legacy-evaluation",
      "evaluation-started",
      "2026-08-23T12:00:00.000Z",
      JSON.stringify({ scenario: "ready" }),
    );
  database
    .prepare(
      `INSERT INTO idempotency_records(
        scope, key, request_json, response_json, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      "legacy:scope",
      "legacy-key",
      JSON.stringify({ request: "same" }),
      JSON.stringify({ response: "preserved" }),
      "2026-08-23T12:00:00.000Z",
    );
}

function hashLegacyRows(database: DatabaseSync): string {
  const records = [
    database.prepare("SELECT * FROM evaluations ORDER BY evaluation_id").all(),
    database.prepare("SELECT * FROM evaluation_events ORDER BY event_id").all(),
    database
      .prepare("SELECT * FROM idempotency_records ORDER BY scope, key")
      .all(),
  ];
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

function readMigrationVersions(database: DatabaseSync): readonly number[] {
  const rows = database
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all() as unknown as readonly { readonly version: number }[];
  return rows.map((row) => row.version);
}

function schemaNames(
  database: DatabaseSync,
  type: "table" | "index" | "trigger",
  explicitOnly = false,
): readonly string[] {
  const rows = database
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = ? AND name NOT LIKE 'sqlite_%'
         ${explicitOnly ? "AND sql IS NOT NULL" : ""}
       ORDER BY name`,
    )
    .all(type) as unknown as readonly { readonly name: string }[];
  return rows.map((row) => row.name);
}

function hasSchemaObject(
  database: DatabaseSync,
  type: string,
  name: string,
): boolean {
  const row = database
    .prepare("SELECT 1 AS found FROM sqlite_schema WHERE type = ? AND name = ?")
    .get(type, name) as { readonly found: number } | undefined;
  return row?.found === 1;
}

function countRows(database: DatabaseSync, table: string): number {
  const allowed = new Set([
    "evaluations",
    "evaluation_events",
    "idempotency_records",
    "release_runs",
    "release_run_events",
  ]);
  if (!allowed.has(table)) throw new Error("Unexpected test table.");
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { readonly count: number } | undefined;
  return row?.count ?? -1;
}
