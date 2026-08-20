import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  IdempotencyConflictError,
  SQLiteEvaluationLedger,
} from "../src/index.js";

const EVALUATION = Object.freeze({
  evaluationId: "evaluation-1",
  scenario: "ready",
  candidate: Object.freeze({
    schemaVersion: "1",
    repository: "YongHwan2161/quietops",
    branch: "main",
    commit: "9854d5cc21840c15652fea3e032b1711a940d57a",
    deploymentUrl: "https://quietops.example.invalid/releases/demo",
  }),
  parentEvaluationId: null,
  createdAt: "2026-08-20T00:00:00.000Z",
});

const STARTED_EVENT = Object.freeze({
  eventId: "event-1",
  evaluationId: EVALUATION.evaluationId,
  sequence: 1,
  eventType: "evaluation-started",
  occurredAt: EVALUATION.createdAt,
  payload: Object.freeze({ scenario: "ready", parentEvaluationId: null }),
});

test("persists evaluations and enforces append-only tables", () => {
  const directory = mkdtempSync(join(tmpdir(), "quietops-ledger-"));
  const databasePath = join(directory, "ledger.sqlite");
  const ledger = new SQLiteEvaluationLedger(databasePath);

  try {
    ledger.commit({ evaluations: [EVALUATION], events: [STARTED_EVENT] });
    assert.equal(ledger.checkIntegrity(), "ok");
    assert.deepEqual(ledger.getEvaluation(EVALUATION.evaluationId), EVALUATION);
    assert.equal(ledger.listEvents(EVALUATION.evaluationId).length, 1);
  } finally {
    ledger.close();
  }

  const database = new DatabaseSync(databasePath);
  try {
    assert.throws(
      () =>
        database
          .prepare(
            "UPDATE evaluations SET scenario = ? WHERE evaluation_id = ?",
          )
          .run("changed", EVALUATION.evaluationId),
      /evaluations are append-only/,
    );
    assert.throws(
      () =>
        database
          .prepare("DELETE FROM evaluation_events WHERE event_id = ?")
          .run(STARTED_EVENT.eventId),
      /evaluation events are append-only/,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("replays the first idempotent response and rejects key reuse", () => {
  const ledger = new SQLiteEvaluationLedger();
  try {
    ledger.commit({ evaluations: [EVALUATION], events: [STARTED_EVENT] });

    const first = ledger.commit({
      events: [
        {
          eventId: "event-2",
          evaluationId: EVALUATION.evaluationId,
          sequence: 2,
          eventType: "human-decision-recorded",
          occurredAt: "2026-08-20T00:01:00.000Z",
          payload: { decision: "Reject" },
        },
      ],
      idempotency: {
        scope: "decision:evaluation-1",
        key: "request-1",
        request: { actor: "judge", decision: "Reject" },
        response: { eventId: "event-2" },
        createdAt: "2026-08-20T00:01:00.000Z",
      },
    });
    assert.equal(first.replayed, false);

    const replay = ledger.commit({
      events: [
        {
          eventId: "must-not-be-inserted",
          evaluationId: EVALUATION.evaluationId,
          sequence: 3,
          eventType: "unexpected",
          occurredAt: "2026-08-20T00:02:00.000Z",
          payload: {},
        },
      ],
      idempotency: {
        scope: "decision:evaluation-1",
        key: "request-1",
        request: { decision: "Reject", actor: "judge" },
        response: { eventId: "different" },
        createdAt: "2026-08-20T00:02:00.000Z",
      },
    });
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.response, { eventId: "event-2" });
    assert.equal(ledger.listEvents(EVALUATION.evaluationId).length, 2);

    assert.throws(
      () =>
        ledger.findIdempotency("decision:evaluation-1", "request-1", {
          actor: "judge",
          decision: "Re-check requested",
        }),
      IdempotencyConflictError,
    );
  } finally {
    ledger.close();
  }
});
