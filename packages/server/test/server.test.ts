import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runLiveReleaseVerification } from "@quietops/agent";

import { createQuietOpsServer } from "../src/index.js";

const RELEASE_COMMIT = "924686c12afbcd437466fd56d0ea24be8df36696";

test("serves one persisted Ready and mismatch workflow over HTTP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quietops-server-"));
  const databasePath = join(directory, "ledger.sqlite");
  const app = await createQuietOpsServer({ databasePath, seedDemo: true });

  try {
    const inboxResponse = await app.inject({
      method: "GET",
      url: "/api/inbox",
    });
    assert.equal(inboxResponse.statusCode, 200);
    assert.match(
      inboxResponse.headers["content-security-policy"] ?? "",
      /default-src 'self'/,
    );

    const healthResponse = await app.inject({ method: "GET", url: "/health" });
    assert.equal(healthResponse.statusCode, 200);
    assert.deepEqual(healthResponse.json(), { status: "ok" });
    assert.equal(healthResponse.headers["cache-control"], "no-store");

    const readinessResponse = await app.inject({
      method: "GET",
      url: "/ready",
    });
    assert.equal(readinessResponse.statusCode, 503);
    assert.deepEqual(readinessResponse.json(), {
      status: "not-ready",
      database: true,
      worker: false,
      migrationVersion: 2,
    });
    assert.doesNotMatch(readinessResponse.body, /sqlite|token|secret|path/i);

    const inbox = inboxResponse.json<{
      capabilities: { decisionMode: string };
      items: Array<{
        evaluationId: string;
        outcome: string;
        attentionRequired: boolean;
      }>;
    }>();
    assert.equal(inbox.capabilities.decisionMode, "local-interactive");
    assert.equal(inbox.items.length, 2);
    assert.equal(inbox.items[0]?.outcome, "Needs decision");
    assert.equal(inbox.items[0]?.attentionRequired, true);
    assert.equal(inbox.items[1]?.outcome, "Ready");

    const mismatchId = inbox.items[0]!.evaluationId;
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/evaluations/${mismatchId}`,
    });
    assert.equal(detailResponse.statusCode, 200);
    const detail = detailResponse.json<{
      evaluation: {
        allowedHumanDecisions: string[];
        evidence: unknown[];
        toolCalls: unknown[];
        externalMutations: number;
      };
    }>();
    assert.deepEqual(detail.evaluation.allowedHumanDecisions, [
      "Reject",
      "Re-check requested",
    ]);
    assert.equal(detail.evaluation.evidence.length, 3);
    assert.equal(detail.evaluation.toolCalls.length, 3);
    assert.equal(detail.evaluation.externalMutations, 0);

    const browserResponse = await app.inject({ method: "GET", url: "/" });
    assert.equal(browserResponse.statusCode, 200);
    assert.match(browserResponse.headers["content-type"] ?? "", /^text\/html/);
    assert.match(browserResponse.body, /AUTONOMY WITH A HUMAN BOUNDARY/);
    assert.match(browserResponse.body, /Stop babysitting releases/);
    assert.match(browserResponse.body, /Compare a quiet completion/);
    assert.match(browserResponse.body, /What needs you/);
    assert.doesNotMatch(browserResponse.body, /Verify this live release/);
    assert.doesNotMatch(browserResponse.body, /<script[^>]*>[^<]/);

    const browserScript = await app.inject({ method: "GET", url: "/app.js" });
    assert.equal(browserScript.statusCode, 200);
    assert.match(browserScript.body, /requestJson\("\/api\/release-runs"\)/);
    assert.match(browserScript.body, /\/api\/decisions\//);
    assert.match(browserScript.body, /input\.type = "password"/);
    assert.match(browserScript.body, /pollIntervalMs/);
    assert.match(browserScript.body, /incidentActionEnabled/);
    assert.match(browserScript.body, /button\.disabled = incidentDisabled/);
    assert.doesNotMatch(browserScript.body, /localStorage|sessionStorage/);
    assert.doesNotMatch(
      browserScript.body,
      /api\/live-verifications|api\/inbox/,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("reports ready only after the configured worker emits a fresh heartbeat", async () => {
  const app = await createQuietOpsServer({
    readinessConfigurationPassed: true,
    releaseWorker: {
      workerId: "server:readiness-test",
      runObservation: async () => {
        throw new Error("No release run should be observed in this test.");
      },
      pollIntervalMs: 5,
    },
  });

  try {
    let response = await app.inject({ method: "GET", url: "/ready" });
    for (
      let attempt = 0;
      response.statusCode !== 200 && attempt < 20;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      response = await app.inject({ method: "GET", url: "/ready" });
    }
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: "ready",
      database: true,
      worker: true,
      migrationVersion: 2,
    });
    assert.doesNotMatch(response.body, /sqlite|token|secret|path/i);
  } finally {
    await app.close();
  }
});

test("stays not ready when a live worker lacks runtime configuration attestation", async () => {
  const app = await createQuietOpsServer({
    releaseWorker: {
      workerId: "server:unattested-readiness-test",
      runObservation: async () => {
        throw new Error("No release run should be observed in this test.");
      },
      pollIntervalMs: 5,
    },
  });

  try {
    await app.ready();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const response = await app.inject({ method: "GET", url: "/ready" });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      status: "not-ready",
      database: true,
      worker: false,
      migrationVersion: 2,
    });
  } finally {
    await app.close();
  }
});

test("lets a public visitor run and replay the fixed live release verification", async () => {
  let runnerCalls = 0;
  const app = await createQuietOpsServer({
    decisionMode: "public-read-only",
    releaseCommit: RELEASE_COMMIT,
    evaluationServiceOptions: {
      runLiveReleaseVerification: () => {
        runnerCalls += 1;
        return runLiveReleaseVerification({
          githubCollector: async () => liveGitHubBundle(),
          deploymentCollector: async () => liveDeploymentBundle(),
        });
      },
    },
  });

  try {
    const before = (
      await app.inject({ method: "GET", url: "/api/inbox" })
    ).json<{
      capabilities: { liveVerification: { enabled: boolean } };
      items: unknown[];
    }>();
    assert.equal(before.capabilities.liveVerification.enabled, true);
    assert.equal(before.items.length, 0);

    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/live-verifications",
    });
    const replayResponse = await app.inject({
      method: "POST",
      url: "/api/live-verifications",
    });
    assert.equal(firstResponse.statusCode, 200);
    assert.equal(replayResponse.statusCode, 200);

    const first = firstResponse.json<{
      receipt: { evaluationId: string; replayed: boolean };
      evaluation: {
        scenario: string;
        outcome: string;
        evidence: unknown[];
        toolCalls: Array<{ provider: string }>;
        externalMutations: number;
      };
    }>();
    const replay = replayResponse.json<typeof first>();
    assert.equal(runnerCalls, 1);
    assert.equal(first.receipt.replayed, false);
    assert.equal(replay.receipt.replayed, true);
    assert.equal(replay.receipt.evaluationId, first.receipt.evaluationId);
    assert.equal(first.evaluation.scenario, "live-release-verification");
    assert.equal(first.evaluation.outcome, "Ready");
    assert.equal(first.evaluation.evidence.length, 3);
    assert.equal(first.evaluation.toolCalls[2]?.provider, "deployment-marker");
    assert.equal(first.evaluation.externalMutations, 0);
  } finally {
    await app.close();
  }
});

test("fails a live verification request closed when release identity is absent", async () => {
  const app = await createQuietOpsServer();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/live-verifications",
    });
    assert.equal(response.statusCode, 503);
    assert.equal(
      response.json().error.code,
      "LIVE_VERIFICATION_NOT_CONFIGURED",
    );
  } finally {
    await app.close();
  }
});

test("persists an idempotent re-check receipt and child lineage across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quietops-server-"));
  const databasePath = join(directory, "ledger.sqlite");
  const app = await createQuietOpsServer({ databasePath, seedDemo: true });
  let childEvaluationId = "";
  let parentEvaluationId = "";

  try {
    const inbox = (
      await app.inject({ method: "GET", url: "/api/inbox" })
    ).json<{
      items: Array<{ evaluationId: string; attentionRequired: boolean }>;
    }>();
    parentEvaluationId = inbox.items.find(
      (item) => item.attentionRequired,
    )!.evaluationId;
    const command = {
      method: "POST" as const,
      url: `/api/evaluations/${parentEvaluationId}/decisions`,
      headers: {
        "idempotency-key": "browser:test-recheck-1",
        "content-type": "application/json",
      },
      payload: {
        decision: "Re-check requested",
        actor: "browser-test",
        note: "Collect fresh evidence.",
      },
    };

    const firstResponse = await app.inject(command);
    const replayResponse = await app.inject(command);
    assert.equal(firstResponse.statusCode, 200);
    assert.equal(replayResponse.statusCode, 200);

    const first = firstResponse.json<{
      receipt: {
        decisionEventId: string;
        childEvaluationId: string;
        replayed: boolean;
      };
    }>();
    const replay = replayResponse.json<typeof first>();
    assert.equal(first.receipt.replayed, false);
    assert.equal(replay.receipt.replayed, true);
    assert.equal(replay.receipt.decisionEventId, first.receipt.decisionEventId);
    assert.equal(
      replay.receipt.childEvaluationId,
      first.receipt.childEvaluationId,
    );
    childEvaluationId = first.receipt.childEvaluationId;
  } finally {
    await app.close();
  }

  const reopened = await createQuietOpsServer({ databasePath, seedDemo: true });
  try {
    const inbox = (
      await reopened.inject({ method: "GET", url: "/api/inbox" })
    ).json<{ items: Array<{ evaluationId: string }> }>();
    assert.equal(inbox.items.length, 3);
    assert.equal(inbox.items[0]?.evaluationId, childEvaluationId);

    const parent = (
      await reopened.inject({
        method: "GET",
        url: `/api/evaluations/${parentEvaluationId}`,
      })
    ).json<{
      evaluation: {
        decision: { childEvaluationId: string };
        timeline: unknown[];
      };
    }>();
    const child = (
      await reopened.inject({
        method: "GET",
        url: `/api/evaluations/${childEvaluationId}`,
      })
    ).json<{
      evaluation: { parentEvaluationId: string; externalMutations: number };
    }>();
    assert.equal(
      parent.evaluation.decision.childEvaluationId,
      childEvaluationId,
    );
    assert.equal(parent.evaluation.timeline.length, 7);
    assert.equal(child.evaluation.parentEvaluationId, parentEvaluationId);
    assert.equal(child.evaluation.externalMutations, 0);
  } finally {
    await reopened.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("fails invalid and unauthorized decision requests closed", async () => {
  const app = await createQuietOpsServer({ seedDemo: true });
  try {
    const inbox = (
      await app.inject({ method: "GET", url: "/api/inbox" })
    ).json<{
      items: Array<{
        evaluationId: string;
        outcome: string;
      }>;
    }>();
    const mismatch = inbox.items.find(
      (item) => item.outcome === "Needs decision",
    )!;
    const ready = inbox.items.find((item) => item.outcome === "Ready")!;

    const missingKey = await app.inject({
      method: "POST",
      url: `/api/evaluations/${mismatch.evaluationId}/decisions`,
      payload: { decision: "Reject", actor: "test" },
    });
    assert.equal(missingKey.statusCode, 400);
    assert.equal(missingKey.json().error.code, "INVALID_REQUEST");

    const invalidDecision = await app.inject({
      method: "POST",
      url: `/api/evaluations/${mismatch.evaluationId}/decisions`,
      headers: { "idempotency-key": "invalid-1" },
      payload: { decision: "Approve", actor: "test" },
    });
    assert.equal(invalidDecision.statusCode, 400);

    const readyDecision = await app.inject({
      method: "POST",
      url: `/api/evaluations/${ready.evaluationId}/decisions`,
      headers: { "idempotency-key": "ready-1" },
      payload: { decision: "Reject", actor: "test" },
    });
    assert.equal(readyDecision.statusCode, 409);
    assert.equal(readyDecision.json().error.code, "DECISION_NOT_ALLOWED");

    const missingEvaluation = await app.inject({
      method: "GET",
      url: "/api/evaluations/evaluation_missing",
    });
    assert.equal(missingEvaluation.statusCode, 404);
    assert.equal(missingEvaluation.json().error.code, "EVALUATION_NOT_FOUND");
  } finally {
    await app.close();
  }
});

test("keeps public demo evidence readable while rejecting shared-state decisions", async () => {
  const app = await createQuietOpsServer({
    decisionMode: "public-read-only",
    seedDemo: true,
  });

  try {
    const inboxResponse = await app.inject({
      method: "GET",
      url: "/api/inbox",
    });
    assert.equal(inboxResponse.statusCode, 200);
    const inbox = inboxResponse.json<{
      capabilities: { decisionMode: string };
      items: Array<{
        evaluationId: string;
        outcome: string;
      }>;
    }>();
    assert.equal(inbox.capabilities.decisionMode, "public-read-only");
    assert.equal(inbox.items.length, 2);

    const mismatchId = inbox.items.find(
      (item) => item.outcome === "Needs decision",
    )!.evaluationId;
    const before = (
      await app.inject({
        method: "GET",
        url: `/api/evaluations/${mismatchId}`,
      })
    ).json<{
      evaluation: { decision: unknown; timeline: unknown[] };
    }>().evaluation;

    const blocked = await app.inject({
      method: "POST",
      url: `/api/evaluations/${mismatchId}/decisions`,
      headers: { "idempotency-key": "public-demo-blocked-1" },
      payload: { decision: "Reject", actor: "anonymous-visitor" },
    });
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json().error.code, "PUBLIC_DEMO_READ_ONLY");

    const after = (
      await app.inject({
        method: "GET",
        url: `/api/evaluations/${mismatchId}`,
      })
    ).json<{
      evaluation: { decision: unknown; timeline: unknown[] };
    }>().evaluation;
    assert.equal(before.decision, null);
    assert.equal(after.decision, null);
    assert.equal(after.timeline.length, before.timeline.length);
    assert.deepEqual(
      (await app.inject({ method: "GET", url: "/api/inbox" }))
        .json<{ items: Array<{ evaluationId: string }> }>()
        .items.map((item) => item.evaluationId),
      inbox.items.map((item) => item.evaluationId),
    );
  } finally {
    await app.close();
  }
});

test("serves a strict no-store release marker only when configured", async () => {
  const withoutMarker = await createQuietOpsServer();
  try {
    const missing = await withoutMarker.inject({
      method: "GET",
      url: "/.well-known/quietops-release.json",
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    await withoutMarker.close();
  }

  const withMarker = await createQuietOpsServer({
    releaseCommit: RELEASE_COMMIT,
  });
  try {
    const marker = await withMarker.inject({
      method: "GET",
      url: "/.well-known/quietops-release.json",
    });
    assert.equal(marker.statusCode, 200);
    assert.equal(marker.headers["cache-control"], "no-store");
    assert.match(marker.headers["content-type"] ?? "", /^application\/json/);
    assert.deepEqual(marker.json(), {
      schemaVersion: "1",
      repository: "YongHwan2161/quietops",
      commit: RELEASE_COMMIT,
    });
  } finally {
    await withMarker.close();
  }

  await assert.rejects(
    createQuietOpsServer({ releaseCommit: "not-a-full-commit" }),
    /releaseCommit must be 40 lowercase hexadecimal characters/,
  );
});

function liveGitHubBundle() {
  const fetchedAt = "2026-08-23T06:00:00.000Z";
  return Object.freeze({
    target: Object.freeze({
      repository: "YongHwan2161/quietops",
      ref: "main",
      requiredWorkflow: "Verify",
    }),
    source: Object.freeze({
      evidenceId: `github-commit:${RELEASE_COMMIT}`,
      kind: "Source revision" as const,
      status: "Verified" as const,
      value: RELEASE_COMMIT,
      sourceUrl: `https://github.com/YongHwan2161/quietops/commit/${RELEASE_COMMIT}`,
      fetchedAt,
    }),
    ci: Object.freeze({
      evidenceId: "github-actions-run:1",
      kind: "CI status" as const,
      status: "Verified" as const,
      value: "success",
      sourceUrl: "https://github.com/YongHwan2161/quietops/actions/runs/1",
      fetchedAt,
      workflowName: "Verify",
      runId: 1,
      headSha: RELEASE_COMMIT,
      completedAt: fetchedAt,
    }),
    externalMutations: 0 as const,
  });
}

function liveDeploymentBundle() {
  const markerUrl =
    "https://quietops-production.up.railway.app/.well-known/quietops-release.json";
  return Object.freeze({
    target: Object.freeze({
      repository: "YongHwan2161/quietops" as const,
      markerUrl,
    }),
    deployment: Object.freeze({
      evidenceId: `deployment-marker:${RELEASE_COMMIT}`,
      kind: "Deployed revision" as const,
      status: "Verified" as const,
      value: RELEASE_COMMIT,
      sourceUrl: markerUrl,
      fetchedAt: "2026-08-23T06:00:01.000Z",
    }),
    externalMutations: 0 as const,
  });
}
