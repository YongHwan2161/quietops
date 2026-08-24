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
import { resolvePolicyProfile } from "@quietops/contracts";
import { SQLiteReleaseRunLedger } from "@quietops/storage";
import {
  Model,
  type BaseModelConfig,
  type Message,
  type ModelStreamEvent,
  type StreamOptions,
} from "@strands-agents/sdk";

import { ReleaseRunService, ReleaseRunWorker } from "../src/index.js";

const CANDIDATE = "b865758a03352aab76c3a9f0319b80fae4f51acc";
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
    const runObservation = async (request: {
      readonly candidateCommit: string;
      readonly phase: "FIRST_OBSERVATION";
      readonly recheckProposal: {
        readonly waitUntil: string;
        readonly durationMs: number;
        readonly policyProfile: string;
      };
    }) =>
      await runReleaseStewardObservation({
        phase: request.phase,
        candidateCommit: request.candidateCommit,
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

function githubBundle(): GitHubEvidenceBundle {
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
      fetchedAt: OBSERVED_AT,
    }),
    ci: Object.freeze({
      evidenceId: "github-actions-run:32689002351",
      kind: "CI status",
      status: "Verified",
      value: "success",
      sourceUrl:
        "https://github.com/YongHwan2161/quietops/actions/runs/32689002351",
      fetchedAt: OBSERVED_AT,
      workflowName: "Verify",
      runId: 32689002351,
      headSha: CANDIDATE,
      completedAt: OBSERVED_AT,
    }),
    externalMutations: 0,
  });
}

function deploymentBundle(): DeploymentEvidenceBundle {
  const markerUrl =
    "https://quietops-production.up.railway.app/.well-known/quietops-release.json";
  return Object.freeze({
    target: Object.freeze({
      repository: "YongHwan2161/quietops",
      markerUrl,
    }),
    deployment: Object.freeze({
      evidenceId: `deployment-marker:${CANDIDATE}`,
      kind: "Deployed revision",
      status: "Verified",
      value: CANDIDATE,
      sourceUrl: markerUrl,
      fetchedAt: OBSERVED_AT,
    }),
    externalMutations: 0,
  });
}

function homepageBundle(): HomepageSmokeBundle {
  const homepageUrl = "https://quietops-production.up.railway.app/";
  return Object.freeze({
    target: Object.freeze({
      repository: "YongHwan2161/quietops",
      homepageUrl,
    }),
    smoke: Object.freeze({
      evidenceId: `homepage-smoke:quietops-production.up.railway.app:${OBSERVED_AT}`,
      kind: "Homepage smoke",
      status: "Verified",
      value: "healthy",
      sourceUrl: homepageUrl,
      fetchedAt: OBSERVED_AT,
      httpStatus: 200,
      contentType: "text/html; charset=utf-8",
      bodyBytes: 256,
      productMarker: 'data-quietops-product="release-steward"',
    }),
    externalMutations: 0,
  });
}
