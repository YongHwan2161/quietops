import { SQLiteEvaluationLedger } from "@quietops/storage";

import { EvaluationService } from "./evaluation-service.js";

const ledger = new SQLiteEvaluationLedger();

try {
  const service = new EvaluationService(ledger);
  const ready = await service.startDemoEvaluation("ready");
  const mismatch = await service.startDemoEvaluation("deployed-sha-mismatch");
  const beforeDecision = service.listInbox();
  const decision = await service.recordDecision({
    evaluationId: mismatch.evaluationId,
    decision: "Reject",
    actor: "judge-demo",
    note: "Observed deployment does not match the reviewed candidate.",
    idempotencyKey: "judge-demo-reject-1",
  });
  const replay = await service.recordDecision({
    evaluationId: mismatch.evaluationId,
    decision: "Reject",
    actor: "judge-demo",
    note: "Observed deployment does not match the reviewed candidate.",
    idempotencyKey: "judge-demo-reject-1",
  });
  const resolvedMismatch = service.getEvaluation(mismatch.evaluationId);

  requireInvariant(ready.outcome === "Ready", "Ready scenario must pass");
  requireInvariant(
    beforeDecision[0]?.evaluationId === mismatch.evaluationId &&
      beforeDecision[0].attentionRequired,
    "unresolved mismatch must lead the inbox",
  );
  requireInvariant(
    decision.decisionEventId === replay.decisionEventId && replay.replayed,
    "decision retry must replay the original receipt",
  );
  requireInvariant(
    resolvedMismatch.timeline.length === mismatch.timeline.length + 1,
    "decision must append exactly one event",
  );
  requireInvariant(
    ready.externalMutations === 0 && resolvedMismatch.externalMutations === 0,
    "demo must perform zero external mutations",
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "PASS",
        sqliteIntegrity: ledger.checkIntegrity(),
        evaluations: service.listInbox().length,
        ready: {
          outcome: ready.outcome,
          attentionRequired: ready.attentionRequired,
          events: ready.timeline.length,
        },
        mismatch: {
          outcome: resolvedMismatch.outcome,
          attentionRequiredBeforeDecision: true,
          decision: resolvedMismatch.decision?.decision,
          allowedHumanDecisions: resolvedMismatch.allowedHumanDecisions,
          events: resolvedMismatch.timeline.length,
        },
        idempotencyReplay: replay.replayed,
        externalMutations: 0,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  ledger.close();
}

function requireInvariant(
  condition: boolean,
  reason: string,
): asserts condition {
  if (!condition) throw new Error(`LEDGER_DEMO_INVARIANT_FAILED: ${reason}`);
}
