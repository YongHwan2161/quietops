import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  runLiveGitHubSourceCiSlice,
  runLiveReleaseVerification,
  runReadySlice,
} from "@quietops/agent";
import type {
  DeploymentEvidenceBundle,
  GitHubEvidenceBundle,
} from "@quietops/adapters";
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

test("persists live GitHub Strands receipts while refusing Ready without deployment evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quietops-live-github-"));
  const databasePath = join(directory, "evidence.sqlite");
  let evaluationId = "";
  try {
    const ledger = new SQLiteEvaluationLedger(databasePath);
    try {
      const service = new EvaluationService(ledger, {
        clock: () => new Date("2026-08-21T15:30:00.000Z"),
        idFactory: deterministicIdFactory(),
        runLiveGitHubSourceCi: () =>
          runLiveGitHubSourceCiSlice({
            collector: async () => liveGitHubBundle(),
          }),
      });
      const evaluation = await service.startLiveGitHubSourceCiEvaluation();
      evaluationId = evaluation.evaluationId;

      assert.equal(evaluation.scenario, "live-github-source-ci");
      assert.equal(evaluation.outcome, "Could not complete");
      assert.match(evaluation.reason, /missing Deployed revision/);
      assert.equal(evaluation.attentionRequired, false);
      assert.deepEqual(evaluation.allowedHumanDecisions, []);
      assert.equal(evaluation.evidence.length, 2);
      assert.equal(evaluation.toolCalls.length, 2);
      assert.equal(evaluation.timeline.length, 5);
      assert.equal(
        evaluation.toolCalls.every(
          (call) =>
            call.provider === "github" &&
            call.sourceUrl?.startsWith("https://github.com/") &&
            call.externalMutations === 0,
        ),
        true,
      );
      assert.equal(ledger.checkIntegrity(), "ok");
    } finally {
      ledger.close();
    }

    const reopenedLedger = new SQLiteEvaluationLedger(databasePath);
    try {
      const reopened = new EvaluationService(reopenedLedger).getEvaluation(
        evaluationId,
      );
      assert.equal(reopened.outcome, "Could not complete");
      assert.equal(reopened.toolCalls[0]?.provider, "github");
      assert.equal(reopened.toolCalls[1]?.providerRecordId, "32468420217");
      assert.equal(reopened.timeline.length, 5);
    } finally {
      reopenedLedger.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persists and replays one complete live release receipt per idempotency key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quietops-live-release-"));
  const databasePath = join(directory, "evidence.sqlite");
  let runnerCalls = 0;
  let evaluationId = "";
  try {
    const ledger = new SQLiteEvaluationLedger(databasePath);
    try {
      const service = new EvaluationService(ledger, {
        clock: () => new Date("2026-08-23T06:00:02.000Z"),
        idFactory: deterministicIdFactory(),
        runLiveReleaseVerification: () => {
          runnerCalls += 1;
          return runLiveReleaseVerification({
            githubCollector: async () => liveGitHubBundle(),
            deploymentCollector: async () => liveDeploymentBundle(),
          });
        },
      });

      const first =
        await service.startLiveReleaseVerification("release:294a5eb");
      const replay =
        await service.startLiveReleaseVerification("release:294a5eb");
      evaluationId = first.evaluation.evaluationId;

      assert.equal(runnerCalls, 1);
      assert.equal(first.replayed, false);
      assert.equal(replay.replayed, true);
      assert.equal(replay.evaluation.evaluationId, evaluationId);
      assert.equal(first.evaluation.scenario, "live-release-verification");
      assert.equal(first.evaluation.outcome, "Ready");
      assert.equal(first.evaluation.evidence.length, 3);
      assert.equal(first.evaluation.toolCalls.length, 3);
      assert.equal(
        first.evaluation.toolCalls[2]?.provider,
        "deployment-marker",
      );
      assert.equal(first.evaluation.timeline.length, 6);
      assert.equal(first.evaluation.externalMutations, 0);
      assert.equal(ledger.checkIntegrity(), "ok");
    } finally {
      ledger.close();
    }

    const reopenedLedger = new SQLiteEvaluationLedger(databasePath);
    try {
      const reopened = new EvaluationService(reopenedLedger).getEvaluation(
        evaluationId,
      );
      assert.equal(reopened.outcome, "Ready");
      assert.equal(reopened.toolCalls[2]?.provider, "deployment-marker");
      assert.equal(reopened.timeline.length, 6);
    } finally {
      reopenedLedger.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refuses to persist a live release receipt from a foreign deployment marker", async () => {
  const baseline = await runLiveReleaseVerification({
    githubCollector: async () => liveGitHubBundle(),
    deploymentCollector: async () => liveDeploymentBundle(),
  });
  const ledger = new SQLiteEvaluationLedger();
  try {
    const service = new EvaluationService(ledger, {
      runLiveReleaseVerification: async () => ({
        ...baseline,
        toolCalls: Object.freeze([
          ...baseline.toolCalls.slice(0, 2),
          Object.freeze({
            ...baseline.toolCalls[2]!,
            sourceUrl:
              "https://foreign.example/.well-known/quietops-release.json",
          }),
        ]),
      }),
    });

    await assert.rejects(
      service.startLiveReleaseVerification("release:foreign-marker"),
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

function deterministicIdFactory(): (
  kind: "evaluation" | "event" | "decision",
) => string {
  let sequence = 0;
  return (kind) => `${kind}-live-${++sequence}`;
}

function liveGitHubBundle(): GitHubEvidenceBundle {
  const commit = "294a5eb04e9667c797aa7a316d5896c84a4342a1";
  const fetchedAt = "2026-08-21T15:30:00.000Z";
  return Object.freeze({
    target: Object.freeze({
      repository: "YongHwan2161/quietops",
      ref: "main",
      requiredWorkflow: "Verify",
    }),
    source: Object.freeze({
      evidenceId: `github-commit:${commit}`,
      kind: "Source revision",
      status: "Verified",
      value: commit,
      sourceUrl: `https://github.com/YongHwan2161/quietops/commit/${commit}`,
      fetchedAt,
    }),
    ci: Object.freeze({
      evidenceId: "github-actions-run:32468420217",
      kind: "CI status",
      status: "Verified",
      value: "success",
      sourceUrl:
        "https://github.com/YongHwan2161/quietops/actions/runs/32468420217",
      fetchedAt,
      workflowName: "Verify",
      runId: 32468420217,
      headSha: commit,
      completedAt: "2026-08-21T09:33:29Z",
    }),
    externalMutations: 0,
  });
}

function liveDeploymentBundle(): DeploymentEvidenceBundle {
  const commit = "294a5eb04e9667c797aa7a316d5896c84a4342a1";
  const markerUrl =
    "https://quietops-production.up.railway.app/.well-known/quietops-release.json";
  return Object.freeze({
    target: Object.freeze({
      repository: "YongHwan2161/quietops",
      markerUrl,
    }),
    deployment: Object.freeze({
      evidenceId: `deployment-marker:${commit}`,
      kind: "Deployed revision",
      status: "Verified",
      value: commit,
      sourceUrl: markerUrl,
      fetchedAt: "2026-08-23T06:00:01.000Z",
    }),
    externalMutations: 0,
  });
}
