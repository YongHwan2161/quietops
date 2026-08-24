import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseDecisionEnvelope,
  resolvePolicyProfile,
} from "@quietops/contracts";
import { SQLiteReleaseRunLedger } from "@quietops/storage";

import { createQuietOpsServer } from "../src/index.js";

const OPERATOR_TOKEN =
  "quietops-operator-token-that-is-never-persisted-or-logged";
const WRONG_TOKEN = "wrong-operator-token-that-is-long-enough-to-look-valid";
const CANDIDATE = "a0eac505a82ead3c5052edff3a5a9c0248529097";
const AUTHORIZED_AT = "2026-08-24T08:00:31.000Z";

test("keeps the release decision route off without injected operator authority", async () => {
  const app = await createQuietOpsServer();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/decisions/decision-disabled",
      headers: { "idempotency-key": "disabled-1" },
      payload: { choice: "WAIT_AND_RECHECK", expectedRunVersion: 2 },
    });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("authenticates the release owner, replays once, and rejects every stale or unsafe decision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quietops-release-decision-"));
  const databasePath = join(directory, "quietops.sqlite");
  const fixtureLedger = new SQLiteReleaseRunLedger(databasePath);
  const active = createAwaitingDecision(fixtureLedger, "active", {
    expiresAt: "2026-08-24T08:15:30.000Z",
  });
  const escalation = createAwaitingDecision(fixtureLedger, "escalation", {
    expiresAt: "2026-08-24T08:15:30.000Z",
  });
  const expired = createAwaitingDecision(fixtureLedger, "expired", {
    expiresAt: "2026-08-24T08:00:30.500Z",
  });
  fixtureLedger.close();

  const logs: string[] = [];
  let now = Date.parse(AUTHORIZED_AT);
  const app = await createQuietOpsServer({
    databasePath,
    releaseDecision: {
      operatorToken: OPERATOR_TOKEN,
      now: () => new Date(now),
    },
    logger: {
      level: "info",
      stream: { write: (message: string) => logs.push(message) },
    },
  });
  const body = {
    choice: "WAIT_AND_RECHECK" as const,
    expectedRunVersion: active.expectedRunVersion,
  };
  const request = {
    method: "POST" as const,
    url: `/api/decisions/${active.decisionId}`,
    headers: {
      authorization: `Bearer ${OPERATOR_TOKEN}`,
      "idempotency-key": "release-owner-active-1",
    },
    payload: body,
  };

  try {
    for (const authorization of [
      undefined,
      `Bearer ${WRONG_TOKEN}`,
      `bearer ${OPERATOR_TOKEN}`,
      `Bearer  ${OPERATOR_TOKEN}`,
    ]) {
      const response = await app.inject({
        ...request,
        headers: {
          "idempotency-key": "unauthorized-probe-1",
          ...(authorization ? { authorization } : {}),
        },
      });
      assert.equal(response.statusCode, 401);
      assert.equal(
        response.json().error.code,
        "OPERATOR_AUTHENTICATION_REQUIRED",
      );
    }

    const unauthenticatedMalformed = await app.inject({
      ...request,
      headers: { "idempotency-key": "unauthorized-malformed-1" },
      payload: { actor: "browser-supplied" },
    });
    assert.equal(unauthenticatedMalformed.statusCode, 401);

    const actorInjection = await app.inject({
      ...request,
      payload: { ...body, actor: "browser-supplied" },
    });
    assert.equal(actorInjection.statusCode, 400);

    const first = await app.inject(request);
    assert.equal(first.statusCode, 200);
    const firstBody = first.json<{
      receipt: {
        decisionId: string;
        runId: string;
        actor: string;
        authorizedAt: string;
        authorizedRunVersion: number;
        nextWakeAt: string;
        replayed: boolean;
        externalWriteAttempts: number;
      };
      run: { state: string; decisionCount: number };
    }>();
    assert.equal(firstBody.receipt.decisionId, active.decisionId);
    assert.equal(firstBody.receipt.runId, active.runId);
    assert.equal(firstBody.receipt.actor, "release-owner");
    assert.equal(firstBody.receipt.authorizedAt, AUTHORIZED_AT);
    assert.equal(firstBody.receipt.authorizedRunVersion, 3);
    assert.equal(firstBody.receipt.replayed, false);
    assert.equal(firstBody.receipt.externalWriteAttempts, 0);
    assert.equal(firstBody.run.state, "WAITING");
    assert.equal(firstBody.run.decisionCount, 1);

    now += 1_000;
    const replay = await app.inject(request);
    assert.equal(replay.statusCode, 200);
    const replayBody = replay.json<typeof firstBody>();
    assert.equal(replayBody.receipt.replayed, true);
    assert.equal(
      replayBody.receipt.authorizedAt,
      firstBody.receipt.authorizedAt,
    );
    assert.equal(replayBody.receipt.nextWakeAt, firstBody.receipt.nextWakeAt);
    assert.equal(
      replayBody.receipt.authorizedRunVersion,
      firstBody.receipt.authorizedRunVersion,
    );

    const conflictingReplay = await app.inject({
      ...request,
      payload: { ...body, expectedRunVersion: body.expectedRunVersion + 1 },
    });
    assert.equal(conflictingReplay.statusCode, 409);
    assert.equal(
      conflictingReplay.json().error.code,
      "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
    );

    const secondDecision = await app.inject({
      ...request,
      headers: {
        ...request.headers,
        "idempotency-key": "release-owner-active-2",
      },
    });
    assert.equal(secondDecision.statusCode, 409);
    assert.equal(
      secondDecision.json().error.code,
      "RELEASE_RUN_CONCURRENCY_CONFLICT",
    );

    const stale = await app.inject({
      method: "POST",
      url: `/api/decisions/${escalation.decisionId}`,
      headers: {
        authorization: `Bearer ${OPERATOR_TOKEN}`,
        "idempotency-key": "stale-version-1",
      },
      payload: {
        choice: "WAIT_AND_RECHECK",
        expectedRunVersion: escalation.expectedRunVersion + 1,
      },
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error.code, "RELEASE_RUN_CONCURRENCY_CONFLICT");

    const heldEscalation = await app.inject({
      method: "POST",
      url: `/api/decisions/${escalation.decisionId}`,
      headers: {
        authorization: `Bearer ${OPERATOR_TOKEN}`,
        "idempotency-key": "held-escalation-1",
      },
      payload: {
        choice: "ESCALATE_INCIDENT",
        expectedRunVersion: escalation.expectedRunVersion,
      },
    });
    assert.equal(heldEscalation.statusCode, 409);
    assert.equal(
      heldEscalation.json().error.code,
      "RELEASE_DECISION_CHOICE_UNAVAILABLE",
    );

    const expiredResponse = await app.inject({
      method: "POST",
      url: `/api/decisions/${expired.decisionId}`,
      headers: {
        authorization: `Bearer ${OPERATOR_TOKEN}`,
        "idempotency-key": "expired-decision-1",
      },
      payload: {
        choice: "WAIT_AND_RECHECK",
        expectedRunVersion: expired.expectedRunVersion,
      },
    });
    assert.equal(expiredResponse.statusCode, 410);
    assert.equal(expiredResponse.json().error.code, "RELEASE_DECISION_EXPIRED");

    const foreign = await app.inject({
      method: "POST",
      url: "/api/decisions/decision-foreign",
      headers: {
        authorization: `Bearer ${OPERATOR_TOKEN}`,
        "idempotency-key": "foreign-decision-1",
      },
      payload: { choice: "WAIT_AND_RECHECK", expectedRunVersion: 2 },
    });
    assert.equal(foreign.statusCode, 404);
    assert.equal(foreign.json().error.code, "RELEASE_DECISION_NOT_FOUND");
  } finally {
    await app.close();
  }

  const observer = new SQLiteReleaseRunLedger(databasePath);
  try {
    const activeEvents = observer.listEvents(active.runId);
    assert.equal(
      activeEvents.filter((event) => event.eventType === "decision-recorded")
        .length,
      1,
    );
    assert.equal(activeEvents.at(-1)?.payload.actor, "release-owner");
    assert.equal(
      observer.getHead(escalation.runId)?.state,
      "AWAITING_DECISION",
    );
    assert.equal(observer.getHead(expired.runId)?.state, "AWAITING_DECISION");
    assert.equal(observer.checkIntegrity(), "ok");
  } finally {
    observer.close();
  }

  const stored = await readFile(databasePath);
  const logText = logs.join("");
  for (const forbidden of [OPERATOR_TOKEN, WRONG_TOKEN, "browser-supplied"]) {
    assert.equal(stored.includes(Buffer.from(forbidden)), false);
    assert.equal(logText.includes(forbidden), false);
  }
  await rm(directory, { recursive: true, force: true });
});

function createAwaitingDecision(
  ledger: SQLiteReleaseRunLedger,
  suffix: string,
  options: Readonly<{ expiresAt: string }>,
): Readonly<{
  runId: string;
  decisionId: string;
  expectedRunVersion: number;
}> {
  const runId = `run-${suffix}`;
  const decisionId = `decision-${suffix}`;
  const createdAt = "2026-08-24T08:00:00.000Z";
  const requestedAt = "2026-08-24T08:00:30.000Z";
  const policyProfile = resolvePolicyProfile("demo-v1");
  ledger.createRunFromWebhook({
    runId,
    triggerEventId: `event-trigger-${suffix}`,
    repository: "YongHwan2161/quietops",
    branch: "main",
    candidateCommit: CANDIDATE,
    triggerDeliveryId: `delivery-${suffix}`,
    policyProfile,
    createdAt,
  });
  const envelope = parseDecisionEnvelope({
    decisionId,
    runId,
    candidateCommit: CANDIDATE,
    expectedRunVersion: 2,
    evidence: {
      source: {
        evidenceId: `source-${suffix}`,
        fetchedAt: "2026-08-24T08:00:01.000Z",
      },
      ci: {
        evidenceId: `ci-${suffix}`,
        fetchedAt: "2026-08-24T08:00:02.000Z",
      },
      deployment: {
        evidenceId: `deployment-${suffix}`,
        fetchedAt: "2026-08-24T08:00:28.000Z",
      },
      homepageSmoke: {
        evidenceId: `smoke-${suffix}`,
        fetchedAt: "2026-08-24T08:00:29.000Z",
      },
    },
    observationCount: 2,
    waitCount: 1,
    elapsedMs: 30_000,
    missingContext:
      "The candidate remains delayed while the old release is healthy.",
    choices: [
      {
        choice: "WAIT_AND_RECHECK",
        summary: "Wait one final bounded extension without another decision.",
      },
      {
        choice: "ESCALATE_INCIDENT",
        summary: "Authorize one bounded incident attempt without retry.",
      },
    ],
    createdAt: requestedAt,
    expiresAt: options.expiresAt,
    policyProfile,
    idempotencyScope: `release-decision:${decisionId}`,
  });
  ledger.appendTransition({
    runId,
    expectedVersion: 1,
    events: [
      {
        eventId: `event-decision-request-${suffix}`,
        sequence: 2,
        eventType: "decision-requested",
        occurredAt: requestedAt,
        payload: {
          signal: "OBSERVATION_BUDGET_EXHAUSTED",
          decisionId,
          decisionEnvelope: JSON.parse(JSON.stringify(envelope)),
          nextWakeAt: options.expiresAt,
          activeDecisionId: decisionId,
          stopCode: null,
        },
      },
    ],
    nextHead: {
      state: "AWAITING_DECISION",
      nextWakeAt: options.expiresAt,
      activeDecisionId: decisionId,
      updatedAt: requestedAt,
    },
  });
  return Object.freeze({ runId, decisionId, expectedRunVersion: 2 });
}
