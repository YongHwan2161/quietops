import assert from "node:assert/strict";
import test from "node:test";

import { runReadySlice } from "@quietops/agent";
import { SQLiteEvaluationLedger } from "@quietops/storage";

import {
  DecisionNotAllowedError,
  EvaluationAlreadyResolvedError,
  EvaluationService,
  StoredEvaluationInvariantError,
} from "../src/index.js";

test("runs both scenarios through one service and prioritizes the exception", async () => {
  const ledger = new SQLiteEvaluationLedger();
  try {
    const service = createService(ledger);
    const ready = await service.startDemoEvaluation("ready");
    const mismatch = await service.startDemoEvaluation("deployed-sha-mismatch");

    assert.equal(ready.outcome, "Ready");
    assert.equal(ready.attentionRequired, false);
    assert.deepEqual(ready.allowedHumanDecisions, []);
    assert.equal(ready.timeline.length, 6);
    assert.equal(ready.externalMutations, 0);

    assert.equal(mismatch.outcome, "Needs decision");
    assert.equal(mismatch.attentionRequired, true);
    assert.deepEqual(mismatch.allowedHumanDecisions, [
      "Reject",
      "Re-check requested",
    ]);
    assert.equal(mismatch.timeline.length, 6);
    assert.equal(mismatch.externalMutations, 0);

    const inbox = service.listInbox();
    assert.equal(inbox.length, 2);
    assert.equal(inbox[0]?.evaluationId, mismatch.evaluationId);
    assert.equal(inbox[0]?.attentionRequired, true);
    assert.equal(inbox[1]?.evaluationId, ready.evaluationId);
  } finally {
    ledger.close();
  }
});

test("records Reject once and replays the same decision receipt", async () => {
  const ledger = new SQLiteEvaluationLedger();
  try {
    const service = createService(ledger);
    const ready = await service.startDemoEvaluation("ready");
    const mismatch = await service.startDemoEvaluation("deployed-sha-mismatch");
    const command = Object.freeze({
      evaluationId: mismatch.evaluationId,
      decision: "Reject" as const,
      actor: "judge",
      note: "Deployment identity differs.",
      idempotencyKey: "reject-1",
    });

    const first = await service.recordDecision(command);
    const replay = await service.recordDecision(command);
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.decisionEventId, first.decisionEventId);
    assert.equal(replay.childEvaluationId, null);

    const resolved = service.getEvaluation(mismatch.evaluationId);
    assert.equal(resolved.timeline.length, mismatch.timeline.length + 1);
    assert.equal(resolved.decision?.decision, "Reject");
    assert.equal(resolved.attentionRequired, false);

    await assert.rejects(
      service.recordDecision({
        ...command,
        idempotencyKey: "reject-2",
      }),
      EvaluationAlreadyResolvedError,
    );
    await assert.rejects(
      service.recordDecision({
        evaluationId: ready.evaluationId,
        decision: "Reject",
        actor: "judge",
        idempotencyKey: "ready-reject",
      }),
      DecisionNotAllowedError,
    );
  } finally {
    ledger.close();
  }
});

test("records re-check as a child evaluation without rewriting the parent", async () => {
  const ledger = new SQLiteEvaluationLedger();
  try {
    const service = createService(ledger);
    const mismatch = await service.startDemoEvaluation("deployed-sha-mismatch");
    const originalTimeline = mismatch.timeline.map((event) => ({ ...event }));
    const command = Object.freeze({
      evaluationId: mismatch.evaluationId,
      decision: "Re-check requested" as const,
      actor: "judge",
      idempotencyKey: "recheck-1",
    });

    const first = await service.recordDecision(command);
    const replay = await service.recordDecision(command);
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.childEvaluationId, first.childEvaluationId);
    assert.ok(first.childEvaluationId);

    const parent = service.getEvaluation(mismatch.evaluationId);
    const child = service.getEvaluation(first.childEvaluationId);
    assert.deepEqual(parent.timeline.slice(0, 6), originalTimeline);
    assert.equal(parent.timeline.length, 7);
    assert.equal(parent.decision?.decision, "Re-check requested");
    assert.equal(parent.decision?.childEvaluationId, child.evaluationId);
    assert.equal(parent.attentionRequired, false);
    assert.equal(child.parentEvaluationId, parent.evaluationId);
    assert.equal(child.outcome, "Needs decision");
    assert.equal(child.attentionRequired, true);
    assert.equal(child.timeline.length, 6);
    assert.equal(service.listInbox()[0]?.evaluationId, child.evaluationId);
  } finally {
    ledger.close();
  }
});

test("fails closed before persistence when runner receipts do not bind evidence", async () => {
  const ledger = new SQLiteEvaluationLedger();
  try {
    const baseline = await runReadySlice();
    const service = new EvaluationService(ledger, {
      runScenario: async () => ({
        ...baseline,
        policy: {
          ...baseline.policy,
          evidenceIds: ["foreign-evidence"],
        },
      }),
    });

    await assert.rejects(
      service.startDemoEvaluation("ready"),
      StoredEvaluationInvariantError,
    );
    assert.deepEqual(ledger.listEvaluations(), []);
  } finally {
    ledger.close();
  }
});

test("commits a demo scenario batch only after every agent result verifies", async () => {
  const ledger = new SQLiteEvaluationLedger();
  try {
    const baseline = await runReadySlice();
    let runCount = 0;
    const service = new EvaluationService(ledger, {
      runScenario: async () => {
        runCount += 1;
        return runCount === 1
          ? baseline
          : {
              ...baseline,
              policy: {
                ...baseline.policy,
                evidenceIds: ["foreign-evidence"],
              },
            };
      },
    });

    await assert.rejects(
      service.startDemoEvaluations(["ready", "deployed-sha-mismatch"]),
      StoredEvaluationInvariantError,
    );
    assert.deepEqual(ledger.listEvaluations(), []);
  } finally {
    ledger.close();
  }
});

function createService(ledger: SQLiteEvaluationLedger): EvaluationService {
  let sequence = 0;
  return new EvaluationService(ledger, {
    clock: () => new Date("2026-08-20T00:00:00.000Z"),
    idFactory: (kind) => `${kind}-${++sequence}`,
  });
}
