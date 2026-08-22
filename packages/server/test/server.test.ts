import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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
    assert.match(browserResponse.body, /Release decision inbox/);
    assert.doesNotMatch(browserResponse.body, /<script[^>]*>[^<]/);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
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
