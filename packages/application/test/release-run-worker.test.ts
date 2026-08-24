import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  RELEASE_STEWARD_TOOL_NAMES,
  runReleaseStewardObservation,
  type ReleaseStewardObservationResult,
} from "@quietops/agent";
import type {
  DeploymentEvidenceBundle,
  GitHubEvidenceBundle,
  HomepageSmokeBundle,
} from "@quietops/adapters";
import {
  DEPLOYMENT_EVIDENCE_ERROR_CODES,
  DeploymentEvidenceError,
  HOMEPAGE_SMOKE_ERROR_CODES,
  HomepageSmokeError,
} from "@quietops/adapters";
import { resolvePolicyProfile } from "@quietops/contracts";
import { SQLiteReleaseRunLedger } from "@quietops/storage";
import {
  Model,
  type BaseModelConfig,
  type Message,
  type ModelStreamEvent,
  type StreamOptions,
} from "@strands-agents/sdk";

import {
  ReleaseRunService,
  ReleaseRunWorker,
  type ReleaseRunObservationRequest,
} from "../src/index.js";

const CANDIDATE = "b865758a03352aab76c3a9f0319b80fae4f51acc";
const OLD_DEPLOYMENT = "1111111111111111111111111111111111111111";
const OCCURRED_AT = "2026-08-24T05:00:00.000Z";
const OBSERVED_AT = "2026-08-24T05:00:01.000Z";

describe("durable release run worker", () => {
  it("quietly completes the same persisted run through a real bounded Strands cycle", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quietops-worker-"));
    const databasePath = join(directory, "quietops.sqlite");
    const ledger = new SQLiteReleaseRunLedger(databasePath);
    let id = 0;
    const service = new ReleaseRunService(ledger, {
      idFactory: (kind) => `${kind}:test-${++id}`,
    });
    const trigger = service.createFromTrigger({
      candidateCommit: CANDIDATE,
      deliveryId: "22222222-3333-4444-5555-666666666666",
      policyProfile: resolvePolicyProfile("demo-v1"),
      occurredAt: OCCURRED_AT,
    });
    assert.equal(trigger.projection.state, "MONITORING");

    let githubCollections = 0;
    let deploymentCollections = 0;
    let smokeCollections = 0;
    const runObservation = async (
      request: Readonly<ReleaseRunObservationRequest>,
    ) =>
      await runReleaseStewardObservation({
        phase: request.phase,
        candidateCommit: request.candidateCommit,
        ...(request.immutableEvidenceIds
          ? { immutableEvidenceIds: request.immutableEvidenceIds }
          : {}),
        modelMode: "injected-test",
        model: new ToolSequenceModel([
          RELEASE_STEWARD_TOOL_NAMES.source,
          RELEASE_STEWARD_TOOL_NAMES.ci,
          RELEASE_STEWARD_TOOL_NAMES.deployment,
          RELEASE_STEWARD_TOOL_NAMES.smoke,
        ]),
        githubCollector: async () => {
          githubCollections += 1;
          return githubBundle();
        },
        deploymentCollector: async () => {
          deploymentCollections += 1;
          return deploymentBundle();
        },
        homepageCollector: async () => {
          smokeCollections += 1;
          return homepageBundle();
        },
        recheckProposal: request.recheckProposal,
      });
    const firstWorker = new ReleaseRunWorker({
      service,
      workerId: "worker:first",
      runObservation,
      clock: () => new Date(OBSERVED_AT),
    });
    const competingWorker = new ReleaseRunWorker({
      service,
      workerId: "worker:competing",
      runObservation,
      clock: () => new Date(OBSERVED_AT),
    });

    const [winner, loser] = await Promise.all([
      firstWorker.tick(),
      competingWorker.tick(),
    ]);
    assert.equal(winner.status, "committed");
    assert.equal(winner.runId, trigger.runId);
    assert.equal(winner.state, "COMPLETED");
    assert.equal(winner.toolCallCount, 4);
    assert.equal(winner.humanPrompts, 0);
    assert.equal(winner.externalWriteAttempts, 0);
    assert.equal(loser.status, "idle");

    assert.equal(githubCollections, 1);
    assert.equal(deploymentCollections, 1);
    assert.equal(smokeCollections, 1);
    const projection = service.getProjection(trigger.runId);
    assert.deepEqual(projection.stateHistory, ["MONITORING", "COMPLETED"]);
    assert.equal(projection.observationCount, 1);
    assert.equal(projection.evidenceCount, 4);
    assert.equal(projection.toolCallCount, 4);
    assert.equal(projection.humanPrompts, 0);
    assert.equal(projection.externalWriteAttempts, 0);
    assert.equal(projection.quietCompletion, true);
    assert.equal(projection.runId, trigger.runId);
    assert.deepEqual(
      ledger.listEvents(trigger.runId).map((event) => event.eventType),
      ["release-triggered", "observation-recorded", "run-completed"],
    );

    const replay = service.createFromTrigger({
      candidateCommit: CANDIDATE,
      deliveryId: "22222222-3333-4444-5555-666666666666",
      policyProfile: resolvePolicyProfile("demo-v1"),
      occurredAt: OCCURRED_AT,
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.runId, trigger.runId);
    assert.equal(replay.projection.version, 3);
    assert.equal(ledger.listEvents(trigger.runId).length, 3);

    assert.deepEqual(await firstWorker.stop(), {
      started: false,
      drained: true,
      claimedRunId: null,
    });
    assert.deepEqual(await competingWorker.stop(), {
      started: false,
      drained: true,
      claimedRunId: null,
    });
    ledger.close();

    const reopenedLedger = new SQLiteReleaseRunLedger(databasePath);
    try {
      const reopened = new ReleaseRunService(reopenedLedger).getProjection(
        trigger.runId,
      );
      assert.equal(reopened.runId, trigger.runId);
      assert.equal(reopened.state, "COMPLETED");
      assert.equal(reopened.quietCompletion, true);
      assert.equal(reopened.externalWriteAttempts, 0);
    } finally {
      reopenedLedger.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it(
    "persists a real five-second wait, resumes the same run after restart, asks once, and expires without action",
    { timeout: 15_000 },
    async (testContext) => {
      const directory = await mkdtemp(join(tmpdir(), "quietops-real-wait-"));
      const databasePath = join(directory, "quietops.sqlite");
      let ledger = new SQLiteReleaseRunLedger(databasePath);
      let id = 0;
      let observationCalls = 0;
      const createService = () =>
        new ReleaseRunService(ledger, {
          idFactory: (kind) => `${kind}:real-wait-${++id}`,
        });
      let service = createService();
      const trigger = service.createFromTrigger({
        candidateCommit: CANDIDATE,
        deliveryId: "12345678-aaaa-bbbb-cccc-123456789abc",
        policyProfile: resolvePolicyProfile("demo-v1"),
        occurredAt: new Date().toISOString(),
      });
      const runObservation = async (
        request: Readonly<ReleaseRunObservationRequest>,
      ) => {
        observationCalls += 1;
        const fetchedAt = new Date().toISOString();
        const toolNames =
          request.phase === "FIRST_OBSERVATION"
            ? [
                RELEASE_STEWARD_TOOL_NAMES.source,
                RELEASE_STEWARD_TOOL_NAMES.ci,
                RELEASE_STEWARD_TOOL_NAMES.deployment,
                RELEASE_STEWARD_TOOL_NAMES.smoke,
                RELEASE_STEWARD_TOOL_NAMES.recheck,
              ]
            : [
                RELEASE_STEWARD_TOOL_NAMES.deployment,
                RELEASE_STEWARD_TOOL_NAMES.smoke,
                RELEASE_STEWARD_TOOL_NAMES.recheck,
              ];
        return await runReleaseStewardObservation({
          phase: request.phase,
          candidateCommit: request.candidateCommit,
          ...(request.immutableEvidenceIds
            ? { immutableEvidenceIds: request.immutableEvidenceIds }
            : {}),
          modelMode: "injected-test",
          model: new ToolSequenceModel(toolNames),
          githubCollector: async () => githubBundle(fetchedAt),
          deploymentCollector: async () =>
            deploymentBundle(OLD_DEPLOYMENT, fetchedAt),
          homepageCollector: async () => homepageBundle(fetchedAt),
          recheckProposal: request.recheckProposal,
        });
      };
      const firstWorker = new ReleaseRunWorker({
        service,
        workerId: "worker:real-wait-first",
        runObservation,
      });

      try {
        const first = await firstWorker.tick();
        assert.equal(first.status, "committed");
        assert.equal(first.runId, trigger.runId);
        assert.equal(first.state, "WAITING");
        assert.equal(first.signal, "NORMAL_WAIT_REQUIRED");
        const beforeRestart = service.getProjection(trigger.runId);
        assert.equal(beforeRestart.observationCount, 1);
        assert.equal(beforeRestart.waitCount, 1);
        assert.equal(beforeRestart.decisionCount, 0);
        assert.equal(beforeRestart.externalWriteAttempts, 0);
        assert.ok(beforeRestart.nextWakeAt);
        const preservedWakeAt = beforeRestart.nextWakeAt;
        assert.deepEqual(
          ledger.listEvents(trigger.runId).map((event) => event.eventType),
          ["release-triggered", "observation-recorded", "wait-scheduled"],
        );

        await firstWorker.stop();
        ledger.close();
        ledger = new SQLiteReleaseRunLedger(databasePath);
        service = createService();
        const afterRestart = service.getProjection(trigger.runId);
        assert.equal(afterRestart.runId, trigger.runId);
        assert.equal(afterRestart.nextWakeAt, preservedWakeAt);
        assert.equal(afterRestart.state, "WAITING");

        const resumedWorker = new ReleaseRunWorker({
          service,
          workerId: "worker:real-wait-resumed",
          runObservation,
        });
        assert.deepEqual(await resumedWorker.tick(), {
          status: "idle",
          runId: null,
        });
        const remainingMs = Math.max(
          0,
          Date.parse(preservedWakeAt!) - Date.now() + 30,
        );
        await new Promise((resolve) => setTimeout(resolve, remainingMs));

        const woke = await resumedWorker.tick();
        assert.equal(woke.status, "committed");
        assert.equal(woke.runId, trigger.runId);
        assert.equal(woke.state, "MONITORING");
        assert.equal(woke.signal, "WAIT_DUE");
        const decision = await resumedWorker.tick();
        assert.equal(decision.status, "committed");
        assert.equal(decision.runId, trigger.runId);
        assert.equal(decision.state, "AWAITING_DECISION");
        assert.equal(decision.signal, "OBSERVATION_BUDGET_EXHAUSTED");
        assert.equal(observationCalls, 2);

        const awaiting = service.getProjection(trigger.runId);
        assert.equal(awaiting.runId, trigger.runId);
        assert.equal(awaiting.observationCount, 2);
        assert.equal(awaiting.waitCount, 1);
        assert.ok(awaiting.measuredWaitMs >= 5_000);
        assert.equal(awaiting.decisionCount, 1);
        assert.equal(awaiting.humanPrompts, 1);
        assert.equal(awaiting.externalWriteAttempts, 0);
        assert.ok(awaiting.activeDecisionId);
        assert.ok(awaiting.decisionEnvelope);
        assert.equal(
          awaiting.decisionEnvelope?.decisionId,
          awaiting.activeDecisionId,
        );
        assert.equal(awaiting.decisionEnvelope?.runId, trigger.runId);
        assert.equal(awaiting.decisionEnvelope?.candidateCommit, CANDIDATE);
        assert.equal(
          awaiting.decisionEnvelope?.expectedRunVersion,
          awaiting.version,
        );
        assert.equal(awaiting.decisionEnvelope?.observationCount, 2);
        assert.equal(awaiting.decisionEnvelope?.waitCount, 1);
        assert.equal(
          awaiting.decisionEnvelope?.evidence.source.evidenceId,
          `github-commit:${CANDIDATE}`,
        );
        assert.equal(
          awaiting.decisionEnvelope?.evidence.deployment.evidenceId,
          `deployment-marker:${OLD_DEPLOYMENT}`,
        );
        assert.deepEqual(
          awaiting.decisionEnvelope?.choices.map((choice) => choice.choice),
          ["WAIT_AND_RECHECK", "ESCALATE_INCIDENT"],
        );
        assert.deepEqual(await resumedWorker.tick(), {
          status: "idle",
          runId: null,
        });
        assert.equal(
          ledger
            .listEvents(trigger.runId)
            .filter((event) => event.eventType === "decision-requested").length,
          1,
        );

        const expiresAt = awaiting.decisionEnvelope!.expiresAt;
        await resumedWorker.stop();
        ledger.close();
        ledger = new SQLiteReleaseRunLedger(databasePath);
        service = createService();
        const expiryWorker = new ReleaseRunWorker({
          service,
          workerId: "worker:decision-expiry",
          clock: () => new Date(expiresAt),
          runObservation: async () => {
            throw new Error("Decision expiry must not observe or write.");
          },
        });
        const expired = await expiryWorker.tick();
        assert.equal(expired.status, "committed");
        assert.equal(expired.runId, trigger.runId);
        assert.equal(expired.state, "STOPPED");
        assert.equal(expired.signal, "DECISION_EXPIRED");
        const stopped = service.getProjection(trigger.runId);
        assert.equal(stopped.runId, trigger.runId);
        assert.equal(stopped.decisionCount, 1);
        assert.equal(stopped.externalWriteAttempts, 0);
        assert.equal(stopped.nextWakeAt, null);
        assert.equal(stopped.activeDecisionId, null);
        assert.deepEqual(stopped.stateHistory, [
          "MONITORING",
          "WAITING",
          "MONITORING",
          "AWAITING_DECISION",
          "STOPPED",
        ]);
        testContext.diagnostic(
          `item-6 evidence ${JSON.stringify({
            runId: trigger.runId,
            restartRunId: stopped.runId,
            nextWakeAt: preservedWakeAt,
            measuredWaitMs: awaiting.measuredWaitMs,
            observationCount: awaiting.observationCount,
            decisionCount: stopped.decisionCount,
            externalWriteAttempts: stopped.externalWriteAttempts,
          })}`,
        );
        await expiryWorker.stop();
      } finally {
        ledger.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("holds a restarted run immediately before its due time and wakes it at the exact boundary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quietops-wait-boundary-"));
    const databasePath = join(directory, "quietops.sqlite");
    let ledger = new SQLiteReleaseRunLedger(databasePath);
    const service = new ReleaseRunService(ledger);
    const trigger = service.createFromTrigger({
      candidateCommit: CANDIDATE,
      deliveryId: "abcdefab-1111-2222-3333-abcdefabcdef",
      policyProfile: resolvePolicyProfile("demo-v1"),
      occurredAt: OCCURRED_AT,
    });
    let now = Date.parse(OBSERVED_AT);
    const firstWorker = new ReleaseRunWorker({
      service,
      workerId: "worker:boundary-first",
      clock: () => new Date(now),
      runObservation: oldDeploymentObservation,
    });

    try {
      const first = await firstWorker.tick();
      assert.equal(first.status, "committed");
      assert.equal(first.state, "WAITING");
      const before = service.getProjection(trigger.runId);
      const nextWakeAt = before.nextWakeAt!;
      assert.equal(nextWakeAt, "2026-08-24T05:00:06.000Z");
      await firstWorker.stop();
      ledger.close();

      ledger = new SQLiteReleaseRunLedger(databasePath);
      const reopened = new ReleaseRunService(ledger);
      now = Date.parse(nextWakeAt) - 1;
      const resumedWorker = new ReleaseRunWorker({
        service: reopened,
        workerId: "worker:boundary-resumed",
        clock: () => new Date(now),
        runObservation: oldDeploymentObservation,
      });
      assert.deepEqual(await resumedWorker.tick(), {
        status: "idle",
        runId: null,
      });
      assert.equal(
        reopened.getProjection(trigger.runId).nextWakeAt,
        nextWakeAt,
      );
      now += 1;
      const woke = await resumedWorker.tick();
      assert.equal(woke.status, "committed");
      assert.equal(woke.runId, trigger.runId);
      assert.equal(woke.signal, "WAIT_DUE");
      assert.equal(reopened.getProjection(trigger.runId).state, "MONITORING");
      await resumedWorker.stop();
    } finally {
      ledger.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("stops unhealthy and unavailable observations without a decision or write", async () => {
    const cases = [
      {
        name: "unhealthy-homepage",
        error: new HomepageSmokeError(
          HOMEPAGE_SMOKE_ERROR_CODES.unhealthy,
          "product marker missing",
        ),
        signal: "HOMEPAGE_SMOKE_UNHEALTHY" as const,
      },
      {
        name: "missing-deployment",
        error: new DeploymentEvidenceError(
          DEPLOYMENT_EVIDENCE_ERROR_CODES.notFound,
          "deployment marker missing",
        ),
        signal: "EVIDENCE_UNAVAILABLE" as const,
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const ledger = new SQLiteReleaseRunLedger();
      const service = new ReleaseRunService(ledger);
      const trigger = service.createFromTrigger({
        candidateCommit: CANDIDATE,
        deliveryId: `failure-case-${index}`,
        policyProfile: resolvePolicyProfile("demo-v1"),
        occurredAt: OCCURRED_AT,
      });
      const worker = new ReleaseRunWorker({
        service,
        workerId: `worker:${testCase.name}`,
        clock: () => new Date(OBSERVED_AT),
        runObservation: async () => {
          throw testCase.error;
        },
      });
      const result = await worker.tick();
      assert.equal(result.status, "committed");
      assert.equal(result.runId, trigger.runId);
      assert.equal(result.state, "STOPPED");
      assert.equal(result.signal, testCase.signal);
      const projection = service.getProjection(trigger.runId);
      assert.equal(projection.observationCount, 0);
      assert.equal(projection.decisionCount, 0);
      assert.equal(projection.externalWriteAttempts, 0);
      assert.deepEqual(
        ledger.listEvents(trigger.runId).map((event) => event.eventType),
        ["release-triggered", "run-stopped"],
      );
      await worker.stop();
      ledger.close();
    }
  });

  it("starts idempotently, performs no provider work without a run, and drains", async () => {
    const ledger = new SQLiteReleaseRunLedger();
    const service = new ReleaseRunService(ledger);
    let observationCalls = 0;
    const worker = new ReleaseRunWorker({
      service,
      workerId: "worker:idle",
      pollIntervalMs: 5,
      runObservation: async () => {
        observationCalls += 1;
        throw new Error("No run should reach the observation runner.");
      },
    });

    assert.equal(worker.start(), true);
    assert.equal(worker.start(), false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const shutdown = await worker.stop();
    assert.equal(shutdown.started, true);
    assert.equal(shutdown.drained, true);
    assert.equal(observationCalls, 0);
    assert.deepEqual(await worker.tick(), { status: "stopping", runId: null });
    ledger.close();
  });

  it("refuses a runner that rewrites the evidence-derived transition", async () => {
    const ledger = new SQLiteReleaseRunLedger();
    const service = new ReleaseRunService(ledger);
    const trigger = service.createFromTrigger({
      candidateCommit: CANDIDATE,
      deliveryId: "77777777-8888-9999-aaaa-bbbbbbbbbbbb",
      policyProfile: resolvePolicyProfile("demo-v1"),
      occurredAt: OCCURRED_AT,
    });
    const valid = await runReleaseStewardObservation({
      phase: "FIRST_OBSERVATION",
      candidateCommit: CANDIDATE,
      modelMode: "injected-test",
      model: new ToolSequenceModel([
        RELEASE_STEWARD_TOOL_NAMES.source,
        RELEASE_STEWARD_TOOL_NAMES.ci,
        RELEASE_STEWARD_TOOL_NAMES.deployment,
        RELEASE_STEWARD_TOOL_NAMES.smoke,
      ]),
      githubCollector: async () => githubBundle(),
      deploymentCollector: async () => deploymentBundle(),
      homepageCollector: async () => homepageBundle(),
      recheckProposal: {
        waitUntil: "2026-08-24T05:00:06.000Z",
        durationMs: 5_000,
        policyProfile: "demo-v1@1",
      },
    });
    const forged = Object.freeze({
      ...valid,
      postcondition: Object.freeze({
        ...valid.postcondition,
        signal: "NORMAL_WAIT_REQUIRED" as const,
      }),
    });
    const worker = new ReleaseRunWorker({
      service,
      workerId: "worker:forged-result",
      clock: () => new Date(OBSERVED_AT),
      runObservation: async () => forged,
    });

    await assert.rejects(worker.tick(), /disagrees with deterministic/);
    assert.equal(service.getProjection(trigger.runId).state, "MONITORING");
    assert.equal(ledger.listEvents(trigger.runId).length, 1);
    await worker.stop();
    ledger.close();
  });

  it("bounds shutdown and prevents a late read from committing after close begins", async () => {
    const ledger = new SQLiteReleaseRunLedger();
    const service = new ReleaseRunService(ledger);
    const trigger = service.createFromTrigger({
      candidateCommit: CANDIDATE,
      deliveryId: "cccccccc-dddd-eeee-ffff-000000000000",
      policyProfile: resolvePolicyProfile("demo-v1"),
      occurredAt: OCCURRED_AT,
    });
    const ready = await runReleaseStewardObservation({
      phase: "FIRST_OBSERVATION",
      candidateCommit: CANDIDATE,
      modelMode: "injected-test",
      model: new ToolSequenceModel([
        RELEASE_STEWARD_TOOL_NAMES.source,
        RELEASE_STEWARD_TOOL_NAMES.ci,
        RELEASE_STEWARD_TOOL_NAMES.deployment,
        RELEASE_STEWARD_TOOL_NAMES.smoke,
      ]),
      githubCollector: async () => githubBundle(),
      deploymentCollector: async () => deploymentBundle(),
      homepageCollector: async () => homepageBundle(),
      recheckProposal: {
        waitUntil: "2026-08-24T05:00:06.000Z",
        durationMs: 5_000,
        policyProfile: "demo-v1@1",
      },
    });
    let releaseRead!: (
      result: Readonly<ReleaseStewardObservationResult>,
    ) => void;
    let markStarted!: () => void;
    const runnerStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const blockedRead = new Promise<Readonly<ReleaseStewardObservationResult>>(
      (resolve) => {
        releaseRead = resolve;
      },
    );
    const worker = new ReleaseRunWorker({
      service,
      workerId: "worker:shutdown",
      clock: () => new Date(OBSERVED_AT),
      shutdownTimeoutMs: 100,
      runObservation: async () => {
        markStarted();
        return await blockedRead;
      },
    });

    const tick = worker.tick();
    await runnerStarted;
    const shutdown = await worker.stop();
    assert.equal(shutdown.started, false);
    assert.equal(shutdown.drained, false);
    assert.equal(shutdown.claimedRunId, trigger.runId);

    releaseRead(ready);
    assert.deepEqual(await tick, {
      status: "stopped-before-commit",
      runId: trigger.runId,
    });
    assert.equal(service.getProjection(trigger.runId).state, "MONITORING");
    assert.equal(ledger.listEvents(trigger.runId).length, 1);
    ledger.close();
  });
});

class ToolSequenceModel extends Model<BaseModelConfig> {
  private config: BaseModelConfig = { modelId: "application-test-sequence" };
  private turn = 0;

  constructor(private readonly toolNames: readonly string[]) {
    super();
  }

  override updateConfig(modelConfig: BaseModelConfig): void {
    this.config = { ...this.config, ...modelConfig };
  }

  override getConfig(): BaseModelConfig {
    return { ...this.config };
  }

  override async *stream(
    _messages: Message[],
    _options?: StreamOptions,
  ): AsyncIterable<ModelStreamEvent> {
    const toolName = this.toolNames[this.turn];
    this.turn += 1;
    yield { type: "modelMessageStartEvent", role: "assistant" };
    if (toolName) {
      yield {
        type: "modelContentBlockStartEvent",
        start: {
          type: "toolUseStart",
          name: toolName,
          toolUseId: `tool-${this.turn}`,
        },
      };
      yield {
        type: "modelContentBlockDeltaEvent",
        delta: { type: "toolUseInputDelta", input: "{}" },
      };
      yield { type: "modelContentBlockStopEvent" };
      yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
      return;
    }
    yield { type: "modelContentBlockStartEvent" };
    yield {
      type: "modelContentBlockDeltaEvent",
      delta: {
        type: "textDelta",
        text: "Narration: ask a human. Deterministic policy remains authoritative.",
      },
    };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "endTurn" };
  }
}

async function oldDeploymentObservation(
  request: Readonly<ReleaseRunObservationRequest>,
): Promise<Readonly<ReleaseStewardObservationResult>> {
  const toolNames =
    request.phase === "FIRST_OBSERVATION"
      ? [
          RELEASE_STEWARD_TOOL_NAMES.source,
          RELEASE_STEWARD_TOOL_NAMES.ci,
          RELEASE_STEWARD_TOOL_NAMES.deployment,
          RELEASE_STEWARD_TOOL_NAMES.smoke,
          RELEASE_STEWARD_TOOL_NAMES.recheck,
        ]
      : [
          RELEASE_STEWARD_TOOL_NAMES.deployment,
          RELEASE_STEWARD_TOOL_NAMES.smoke,
          RELEASE_STEWARD_TOOL_NAMES.recheck,
        ];
  return await runReleaseStewardObservation({
    phase: request.phase,
    candidateCommit: request.candidateCommit,
    ...(request.immutableEvidenceIds
      ? { immutableEvidenceIds: request.immutableEvidenceIds }
      : {}),
    modelMode: "injected-test",
    model: new ToolSequenceModel(toolNames),
    githubCollector: async () => githubBundle(OBSERVED_AT),
    deploymentCollector: async () =>
      deploymentBundle(OLD_DEPLOYMENT, OBSERVED_AT),
    homepageCollector: async () => homepageBundle(OBSERVED_AT),
    recheckProposal: request.recheckProposal,
  });
}

function githubBundle(fetchedAt = OBSERVED_AT): GitHubEvidenceBundle {
  return Object.freeze({
    target: Object.freeze({
      repository: "YongHwan2161/quietops",
      ref: "main",
      requiredWorkflow: "Verify",
    }),
    source: Object.freeze({
      evidenceId: `github-commit:${CANDIDATE}`,
      kind: "Source revision",
      status: "Verified",
      value: CANDIDATE,
      sourceUrl: `https://github.com/YongHwan2161/quietops/commit/${CANDIDATE}`,
      fetchedAt,
    }),
    ci: Object.freeze({
      evidenceId: "github-actions-run:32689002351",
      kind: "CI status",
      status: "Verified",
      value: "success",
      sourceUrl:
        "https://github.com/YongHwan2161/quietops/actions/runs/32689002351",
      fetchedAt,
      workflowName: "Verify",
      runId: 32689002351,
      headSha: CANDIDATE,
      completedAt: fetchedAt,
    }),
    externalMutations: 0,
  });
}

function deploymentBundle(
  deployedCommit = CANDIDATE,
  fetchedAt = OBSERVED_AT,
): DeploymentEvidenceBundle {
  const markerUrl =
    "https://quietops-production.up.railway.app/.well-known/quietops-release.json";
  return Object.freeze({
    target: Object.freeze({
      repository: "YongHwan2161/quietops",
      markerUrl,
    }),
    deployment: Object.freeze({
      evidenceId: `deployment-marker:${deployedCommit}`,
      kind: "Deployed revision",
      status: "Verified",
      value: deployedCommit,
      sourceUrl: markerUrl,
      fetchedAt,
    }),
    externalMutations: 0,
  });
}

function homepageBundle(fetchedAt = OBSERVED_AT): HomepageSmokeBundle {
  const homepageUrl = "https://quietops-production.up.railway.app/";
  return Object.freeze({
    target: Object.freeze({
      repository: "YongHwan2161/quietops",
      homepageUrl,
    }),
    smoke: Object.freeze({
      evidenceId: `homepage-smoke:quietops-production.up.railway.app:${fetchedAt}`,
      kind: "Homepage smoke",
      status: "Verified",
      value: "healthy",
      sourceUrl: homepageUrl,
      fetchedAt,
      httpStatus: 200,
      contentType: "text/html; charset=utf-8",
      bodyBytes: 256,
      productMarker: 'data-quietops-product="release-steward"',
    }),
    externalMutations: 0,
  });
}
