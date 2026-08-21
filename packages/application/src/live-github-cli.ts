import { SQLiteEvaluationLedger } from "@quietops/storage";

import { EvaluationService } from "./evaluation-service.js";

const ledger = new SQLiteEvaluationLedger();

try {
  const service = new EvaluationService(ledger);
  const evaluation = await service.startLiveGitHubSourceCiEvaluation();

  requireInvariant(
    evaluation.outcome === "Could not complete",
    "missing deployment evidence must prevent Ready",
  );
  requireInvariant(
    evaluation.evidence.length === 2 && evaluation.toolCalls.length === 2,
    "exactly source and CI evidence must be persisted",
  );
  requireInvariant(
    evaluation.toolCalls.every(
      (call) =>
        call.provider === "github" &&
        call.sourceUrl?.startsWith("https://github.com/") &&
        call.externalMutations === 0,
    ),
    "persisted receipts must bind GitHub sources and zero mutations",
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "PASS",
        mode: "strands-github-source-ci-ledger",
        sqliteIntegrity: ledger.checkIntegrity(),
        evaluation: {
          evaluationId: evaluation.evaluationId,
          scenario: evaluation.scenario,
          candidate: evaluation.candidate,
          outcome: evaluation.outcome,
          reason: evaluation.reason,
          evidence: evaluation.evidence,
          toolCalls: evaluation.toolCalls,
          allowedHumanDecisions: evaluation.allowedHumanDecisions,
          timelineEvents: evaluation.timeline.length,
          externalMutations: evaluation.externalMutations,
        },
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
  if (!condition) {
    throw new Error(`LIVE_GITHUB_LEDGER_INVARIANT_FAILED: ${reason}`);
  }
}
