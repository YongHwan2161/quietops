import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { MAX_GITHUB_WEBHOOK_BODY_BYTES } from "@quietops/adapters";
import type {
  ReleaseRunObservationRunner,
  ReleaseRunWorkerShutdownResult,
} from "@quietops/application";
import { SQLiteReleaseRunLedger } from "@quietops/storage";

import { createQuietOpsServer } from "../src/index.js";

const SECRET = "quietops-server-webhook-secret-32-bytes-minimum";
const COMMIT = "d4fb420548fe562f5d405dba51057b93b2204bb0";
const OTHER_COMMIT = "23f1d3d04cea0e856172c3e436b5e3742e844b80";
const DELIVERY = "11111111-2222-3333-4444-555555555555";
const RAW_SENTINEL = "raw-body-field-that-must-never-be-persisted";

test("keeps the route off by default, then persists and replays one authenticated push", async (t) => {
  const disabled = await createQuietOpsServer();
  try {
    assert.equal(
      (
        await disabled.inject({
          method: "POST",
          url: "/api/github/webhooks",
          payload: {},
        })
      ).statusCode,
      404,
    );
  } finally {
    await disabled.close();
  }

  const directory = await mkdtemp(join(tmpdir(), "quietops-webhook-"));
  const databasePath = join(directory, "ledger.sqlite");
  const logs: string[] = [];
  const app = await createQuietOpsServer({
    databasePath,
    githubWebhook: {
      secret: SECRET,
      policyProfile: "demo-v1",
      now: () => new Date("2026-08-23T14:30:00.000Z"),
    },
    logger: {
      level: "info",
      stream: { write: (message: string) => logs.push(message) },
    },
  });
  const body = pushBody();
  const signature = sign(body);
  let runId = "";
  let firstReceipt: {
    accepted: boolean;
    runId: string;
    replayed: boolean;
  };
  try {
    const startedAt = performance.now();
    const first = await app.inject(webhookRequest(body));
    const elapsedMs = performance.now() - startedAt;
    assert.equal(first.statusCode, 202);
    assert.ok(elapsedMs < 1_000, `webhook response took ${elapsedMs}ms`);
    t.diagnostic(`authenticated 202 response: ${elapsedMs.toFixed(3)} ms`);

    firstReceipt = first.json<{
      accepted: boolean;
      runId: string;
      replayed: boolean;
    }>();
    assert.equal(firstReceipt.accepted, true);
    assert.equal(firstReceipt.replayed, false);
    runId = firstReceipt.runId;

    await new Promise((resolve) => setTimeout(resolve, 20));
    const disabledWorkerObserver = new SQLiteReleaseRunLedger(databasePath);
    try {
      assert.equal(disabledWorkerObserver.getHead(runId)?.state, "MONITORING");
      assert.equal(disabledWorkerObserver.listEvents(runId).length, 1);
    } finally {
      disabledWorkerObserver.close();
    }

    const conflictBody = pushBody({ after: OTHER_COMMIT });
    const conflict = await app.inject(webhookRequest(conflictBody));
    assert.equal(conflict.statusCode, 409);
    assert.equal(
      conflict.json().error.code,
      "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
    );
  } finally {
    await app.close();
  }

  const reopened = await createQuietOpsServer({
    databasePath,
    githubWebhook: { secret: SECRET, policyProfile: "demo-v1" },
    logger: {
      level: "info",
      stream: { write: (message: string) => logs.push(message) },
    },
  });
  try {
    const replay = await reopened.inject(webhookRequest(body));
    assert.equal(replay.statusCode, 202);
    const replayReceipt = replay.json<typeof firstReceipt>();
    assert.equal(replayReceipt.replayed, true);
    assert.equal(replayReceipt.runId, firstReceipt.runId);
  } finally {
    await reopened.close();
  }

  const releaseLedger = new SQLiteReleaseRunLedger(databasePath);
  try {
    assert.equal(releaseLedger.checkIntegrity(), "ok");
    assert.equal(releaseLedger.getRun(runId)?.candidateCommit, COMMIT);
    assert.equal(releaseLedger.getRun(runId)?.triggerDeliveryId, DELIVERY);
    assert.equal(releaseLedger.getRun(runId)?.policyProfile.name, "demo-v1");
    assert.equal(releaseLedger.getHead(runId)?.state, "MONITORING");
    const events = releaseLedger.listEvents(runId);
    assert.equal(events.length, 1);
    assert.deepEqual(Object.keys(events[0]!.payload).sort(), [
      "activeDecisionId",
      "deliveryId",
      "nextWakeAt",
      "signal",
      "stopCode",
    ]);
  } finally {
    releaseLedger.close();
  }

  const database = new DatabaseSync(databasePath);
  try {
    assert.equal(count(database, "release_runs"), 1);
    assert.equal(count(database, "release_run_events"), 1);
  } finally {
    database.close();
  }

  const persistedBytes = await readFile(databasePath);
  const logText = logs.join("");
  for (const forbidden of [SECRET, signature, RAW_SENTINEL]) {
    assert.equal(persistedBytes.includes(Buffer.from(forbidden)), false);
    assert.equal(logText.includes(forbidden), false);
  }
  await rm(directory, { recursive: true, force: true });
});

test("runs a signed trigger to quiet completion with no browser and drains on close", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quietops-webhook-worker-"));
  const databasePath = join(directory, "ledger.sqlite");
  const workerErrors: unknown[] = [];
  let shutdown: Readonly<ReleaseRunWorkerShutdownResult> | undefined;
  let observationCalls = 0;
  const runObservation: ReleaseRunObservationRunner = async (request) => {
    observationCalls += 1;
    return readyObservation(request.candidateCommit);
  };
  const app = await createQuietOpsServer({
    databasePath,
    githubWebhook: {
      secret: SECRET,
      now: () => new Date("2026-08-24T05:00:00.000Z"),
    },
    releaseWorker: {
      workerId: "server:worker-test",
      runObservation,
      pollIntervalMs: 5,
      leaseDurationMs: 500,
      shutdownTimeoutMs: 500,
      clock: () => new Date("2026-08-24T05:00:01.000Z"),
      onError: (error) => workerErrors.push(error),
      onShutdown: (result) => {
        shutdown = result;
      },
    },
  });
  let runId = "";
  try {
    const response = await app.inject(webhookRequest(pushBody()));
    assert.equal(response.statusCode, 202);
    runId = response.json<{ runId: string }>().runId;

    const observer = new SQLiteReleaseRunLedger(databasePath);
    try {
      await waitFor(() => observer.getHead(runId)?.state === "COMPLETED");
      assert.equal(observer.listEvents(runId).length, 3);
    } finally {
      observer.close();
    }

    const replay = await app.inject(webhookRequest(pushBody()));
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.json().runId, runId);
    assert.equal(replay.json().replayed, true);
    assert.equal(observationCalls, 1);
  } finally {
    await app.close();
  }

  assert.deepEqual(workerErrors, []);
  assert.deepEqual(shutdown, {
    started: true,
    drained: true,
    claimedRunId: null,
  });
  const reopened = new SQLiteReleaseRunLedger(databasePath);
  try {
    assert.equal(reopened.getHead(runId)?.state, "COMPLETED");
    assert.deepEqual(
      reopened.listEvents(runId).map((event) => event.eventType),
      ["release-triggered", "observation-recorded", "run-completed"],
    );
  } finally {
    reopened.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("authenticates before parsing and gives signed foreign or deleted events zero runs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quietops-webhook-reject-"));
  const databasePath = join(directory, "ledger.sqlite");
  const logs: string[] = [];
  const app = await createQuietOpsServer({
    databasePath,
    githubWebhook: { secret: SECRET },
    logger: {
      level: "info",
      stream: { write: (message: string) => logs.push(message) },
    },
  });
  const invalidJson = Buffer.from(
    "invalid-json-raw-body-that-must-not-be-logged",
    "utf8",
  );
  const invalidSignatureValue = "sha256=".padEnd(71, "0");
  try {
    const invalidSignature = await app.inject({
      ...webhookRequest(invalidJson),
      headers: webhookHeaders(invalidJson, {
        signature: invalidSignatureValue,
      }),
    });
    assert.equal(invalidSignature.statusCode, 401);
    assert.equal(
      invalidSignature.json().error.code,
      "GITHUB_WEBHOOK_INVALID_SIGNATURE",
    );

    const authenticatedInvalidJson = await app.inject(
      webhookRequest(invalidJson),
    );
    assert.equal(authenticatedInvalidJson.statusCode, 400);
    assert.equal(
      authenticatedInvalidJson.json().error.code,
      "GITHUB_WEBHOOK_INVALID_JSON",
    );

    const invalidDeliveryBody = pushBody();
    const invalidDelivery = await app.inject({
      ...webhookRequest(invalidDeliveryBody),
      headers: {
        ...webhookHeaders(invalidDeliveryBody),
        "x-github-delivery": "bad delivery",
      },
    });
    assert.equal(invalidDelivery.statusCode, 400);
    assert.equal(
      invalidDelivery.json().error.code,
      "GITHUB_WEBHOOK_INVALID_DELIVERY",
    );

    const unsigned = await app.inject({
      ...webhookRequest(pushBody()),
      headers: webhookHeaders(pushBody(), { signature: undefined }),
    });
    assert.equal(unsigned.statusCode, 401);

    const rejections = [
      {
        body: pushBody({
          repository: { full_name: "foreign/repository" },
        }),
        reason: "foreign-repository",
      },
      { body: pushBody({ ref: "refs/heads/feature" }), reason: "foreign-ref" },
      { body: pushBody({ deleted: true }), reason: "deleted-push" },
      {
        body: pushBody(),
        reason: "unsupported-event",
        event: "issues",
      },
    ] as const;
    for (const entry of rejections) {
      const response = await app.inject({
        ...webhookRequest(entry.body),
        headers:
          "event" in entry
            ? webhookHeaders(entry.body, { event: entry.event })
            : webhookHeaders(entry.body),
      });
      assert.equal(response.statusCode, 202);
      assert.deepEqual(response.json(), {
        accepted: false,
        reason: entry.reason,
      });
    }
  } finally {
    await app.close();
  }

  const logText = logs.join("");
  for (const forbidden of [
    SECRET,
    invalidJson.toString("utf8"),
    invalidSignatureValue,
  ]) {
    assert.equal(logText.includes(forbidden), false);
  }

  const database = new DatabaseSync(databasePath);
  try {
    assert.equal(count(database, "release_runs"), 0);
    assert.equal(count(database, "release_run_events"), 0);
    assert.equal(count(database, "release_run_heads"), 0);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects oversized and non-JSON webhook requests without creating a run", async () => {
  const app = await createQuietOpsServer({
    githubWebhook: { secret: SECRET },
  });
  try {
    const oversized = Buffer.alloc(MAX_GITHUB_WEBHOOK_BODY_BYTES + 1, 0x61);
    const oversizedResponse = await app.inject({
      method: "POST",
      url: "/api/github/webhooks",
      headers: webhookHeaders(oversized),
      payload: oversized,
    });
    assert.equal(oversizedResponse.statusCode, 413);
    assert.equal(
      oversizedResponse.json().error.code,
      "GITHUB_WEBHOOK_BODY_TOO_LARGE",
    );

    const body = pushBody();
    const wrongType = await app.inject({
      method: "POST",
      url: "/api/github/webhooks",
      headers: {
        ...webhookHeaders(body),
        "content-type": "application/octet-stream",
      },
      payload: body,
    });
    assert.equal(wrongType.statusCode, 415);
    assert.equal(
      wrongType.json().error.code,
      "GITHUB_WEBHOOK_CONTENT_TYPE_REQUIRED",
    );
  } finally {
    await app.close();
  }
});

function webhookRequest(body: Buffer) {
  return {
    method: "POST" as const,
    url: "/api/github/webhooks",
    headers: webhookHeaders(body),
    payload: body,
  };
}

function webhookHeaders(
  body: Buffer,
  overrides: Partial<{
    signature: string | undefined;
    event: string;
  }> = {},
): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-github-event": overrides.event ?? "push",
    "x-github-delivery": DELIVERY,
    ...(overrides.signature === undefined && "signature" in overrides
      ? {}
      : { "x-hub-signature-256": overrides.signature ?? sign(body) }),
  };
}

function pushBody(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      ref: "refs/heads/main",
      after: COMMIT,
      deleted: false,
      repository: { full_name: "YongHwan2161/quietops" },
      ignored: RAW_SENTINEL,
      ...overrides,
    }),
    "utf8",
  );
}

function sign(body: Uint8Array): string {
  return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

function count(database: DatabaseSync, table: string): number {
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { readonly count: number };
  return row.count;
}

function readyObservation(candidateCommit: string) {
  const fetchedAt = "2026-08-24T05:00:01.000Z";
  const sourceId = `github-commit:${candidateCommit}`;
  const ciId = "github-actions-run:32689002351";
  const deploymentId = `deployment-marker:${candidateCommit}`;
  const smokeId = `homepage-smoke:quietops-production.up.railway.app:${fetchedAt}`;
  return Object.freeze({
    agentRuntime: "@strands-agents/sdk" as const,
    agentRuntimeVersion: "1.13.0" as const,
    modelMode: "injected-test" as const,
    phase: "FIRST_OBSERVATION" as const,
    modelNarration: "Narration is not transition authority.",
    postcondition: Object.freeze({
      signal: "CANDIDATE_READY" as const,
      candidateCommit,
      sourceEvidenceId: sourceId,
      ciEvidenceId: ciId,
      deploymentEvidenceId: deploymentId,
      homepageSmokeEvidenceId: smokeId,
      externalMutations: 0 as const,
    }),
    evidence: Object.freeze([
      Object.freeze({
        evidenceId: sourceId,
        kind: "Source revision" as const,
        status: "Verified" as const,
        value: candidateCommit,
      }),
      Object.freeze({
        evidenceId: ciId,
        kind: "CI status" as const,
        status: "Verified" as const,
        value: "success",
        headSha: candidateCommit,
      }),
      Object.freeze({
        evidenceId: deploymentId,
        kind: "Deployed revision" as const,
        status: "Verified" as const,
        value: candidateCommit,
      }),
      Object.freeze({
        evidenceId: smokeId,
        kind: "Homepage smoke" as const,
        status: "Verified" as const,
        value: "healthy",
      }),
    ]),
    receipts: Object.freeze([
      receipt("observe_source_revision", sourceId, "github", candidateCommit),
      receipt("observe_required_ci", ciId, "github", "32689002351"),
      receipt(
        "observe_deployment_revision",
        deploymentId,
        "deployment-marker",
        candidateCommit,
      ),
      receipt("observe_homepage_smoke", smokeId, "homepage", "200"),
    ]),
    toolCallCounts: Object.freeze({
      observe_source_revision: 1,
      observe_required_ci: 1,
      observe_deployment_revision: 1,
      observe_homepage_smoke: 1,
      schedule_recheck: 0,
    }),
    externalMutations: 0 as const,
  });
}

function receipt(
  toolName:
    | "observe_source_revision"
    | "observe_required_ci"
    | "observe_deployment_revision"
    | "observe_homepage_smoke",
  evidenceId: string,
  provider: "github" | "deployment-marker" | "homepage",
  providerRecordId: string,
) {
  return Object.freeze({
    toolName,
    evidenceId,
    provider,
    providerRecordId,
    fetchedAt: "2026-08-24T05:00:01.000Z",
    externalMutations: 0 as const,
  });
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the release worker.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
