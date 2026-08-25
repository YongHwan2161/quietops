import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createQuietOpsServer } from "../src/index.js";
import { seedReleaseDemoRuns } from "../src/release-demo-seed.js";
import { SQLiteReleaseRunLedger } from "@quietops/storage";

const OPERATOR_TOKEN =
  "quietops-operator-token-that-is-never-persisted-or-logged";

test("projects preserved release histories as an exception-first public inbox", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quietops-release-browser-"));
  const app = await createQuietOpsServer({
    databasePath: join(directory, "quietops.sqlite"),
    seedDemo: true,
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/release-runs",
    });
    assert.equal(response.statusCode, 200);
    const payload = response.json<{
      capabilities: {
        pollIntervalMs: number;
        operatorDecision: {
          enabled: boolean;
          authorityStorage: string;
          incidentActionEnabled: boolean;
        };
      };
      items: Array<{
        runId: string;
        state: string;
        evidenceMode: string;
        attentionRequired: boolean;
        observationCount: number;
        waitCount: number;
        humanPromptCount: number;
        externalWriteAttemptCount: number;
      }>;
    }>();

    assert.equal(payload.capabilities.pollIntervalMs, 2_000);
    assert.deepEqual(payload.capabilities.operatorDecision, {
      enabled: false,
      authorityStorage: "memory-only",
      incidentActionEnabled: false,
    });
    assert.equal(payload.items.length, 2);
    assert.deepEqual(
      payload.items.map((item) => item.runId),
      ["preserved-delayed-release", "preserved-quiet-release"],
    );

    const delayed = payload.items[0]!;
    assert.equal(delayed.state, "AWAITING_DECISION");
    assert.equal(delayed.evidenceMode, "preserved-demo");
    assert.equal(delayed.attentionRequired, true);
    assert.equal(delayed.observationCount, 2);
    assert.equal(delayed.waitCount, 1);
    assert.equal(delayed.humanPromptCount, 1);
    assert.equal(delayed.externalWriteAttemptCount, 0);

    const quiet = payload.items[1]!;
    assert.equal(quiet.state, "COMPLETED");
    assert.equal(quiet.attentionRequired, false);
    assert.equal(quiet.observationCount, 1);
    assert.equal(quiet.waitCount, 0);
    assert.equal(quiet.humanPromptCount, 0);
    assert.equal(quiet.externalWriteAttemptCount, 0);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("puts the human question and consequences before expandable receipts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quietops-release-detail-"));
  const app = await createQuietOpsServer({
    databasePath: join(directory, "quietops.sqlite"),
    seedDemo: true,
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/release-runs/preserved-delayed-release",
    });
    assert.equal(response.statusCode, 200);
    const payload = response.json<{
      capabilities: { canDecide: boolean };
      run: {
        measuredWaitMs: number;
        decision: {
          decisionId: string;
          status: string;
          missingContext: string;
          expectedRunVersion: number;
          choices: Array<{ choice: string; summary: string }>;
        };
        timeline: Array<{ eventType: string }>;
        receipts: Array<{ sourceUrl: string | null }>;
      };
    }>();

    assert.equal(payload.capabilities.canDecide, false);
    assert.equal(payload.run.decision.status, "PENDING");
    assert.equal(payload.run.measuredWaitMs, 5_000);
    assert.match(payload.run.decision.missingContext, /Only the owner knows/);
    assert.equal(payload.run.decision.expectedRunVersion, 6);
    assert.deepEqual(
      payload.run.decision.choices.map((choice) => choice.choice),
      ["WAIT_AND_RECHECK", "ESCALATE_INCIDENT"],
    );
    assert.equal(payload.run.timeline.length, 6);
    assert.deepEqual(
      payload.run.timeline.map((event) => event.eventType),
      [
        "release-triggered",
        "observation-recorded",
        "wait-scheduled",
        "run-woke",
        "observation-recorded",
        "decision-requested",
      ],
    );
    assert.equal(payload.run.receipts.length, 8);
    assert.equal(
      payload.run.receipts.every((receipt) =>
        receipt.sourceUrl === null
          ? true
          : receipt.sourceUrl.startsWith("https://"),
      ),
      true,
    );

    const missing = await app.inject({
      method: "GET",
      url: "/api/release-runs/missing-run",
    });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, "RELEASE_RUN_NOT_FOUND");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("never lets public preserved evidence become operator authority", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quietops-release-guard-"));
  const app = await createQuietOpsServer({
    databasePath: join(directory, "quietops.sqlite"),
    seedDemo: true,
    releaseDecision: { operatorToken: OPERATOR_TOKEN },
  });

  try {
    const detail = (
      await app.inject({
        method: "GET",
        url: "/api/release-runs/preserved-delayed-release",
      })
    ).json<{ capabilities: { canDecide: boolean } }>();
    assert.equal(detail.capabilities.canDecide, false);

    const response = await app.inject({
      method: "POST",
      url: "/api/decisions/preserved-release-decision",
      headers: {
        authorization: `Bearer ${OPERATOR_TOKEN}`,
        "idempotency-key": "preserved-browser-guard-1",
      },
      payload: { choice: "WAIT_AND_RECHECK", expectedRunVersion: 6 },
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, "RELEASE_RUN_STATE_CONFLICT");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("exposes live owner authority for one POST and resumes the same run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quietops-release-live-ui-"));
  const databasePath = join(directory, "quietops.sqlite");
  const fixtureLedger = new SQLiteReleaseRunLedger(databasePath);
  seedReleaseDemoRuns(fixtureLedger, { evidenceMode: "live" });
  fixtureLedger.close();
  const app = await createQuietOpsServer({
    databasePath,
    releaseDecision: {
      operatorToken: OPERATOR_TOKEN,
      now: () => new Date("2026-08-24T11:20:00.000Z"),
    },
  });

  try {
    const before = (
      await app.inject({
        method: "GET",
        url: "/api/release-runs/browser-live-delayed-release",
      })
    ).json<{
      capabilities: { canDecide: boolean };
      run: { runId: string; state: string; evidenceMode: string };
    }>();
    assert.equal(before.capabilities.canDecide, true);
    assert.equal(before.run.evidenceMode, "live");

    const response = await app.inject({
      method: "POST",
      url: "/api/decisions/browser-live-release-decision",
      headers: {
        authorization: `Bearer ${OPERATOR_TOKEN}`,
        "idempotency-key": "live-browser-resume-1",
      },
      payload: { choice: "WAIT_AND_RECHECK", expectedRunVersion: 6 },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().run.runId, before.run.runId);
    assert.equal(response.json().run.state, "WAITING");

    const after = (
      await app.inject({
        method: "GET",
        url: "/api/release-runs/browser-live-delayed-release",
      })
    ).json<{
      capabilities: { canDecide: boolean };
      run: {
        runId: string;
        state: string;
        humanPromptCount: number;
        decision: { status: string; authorizedChoice: string };
      };
    }>();
    assert.equal(after.capabilities.canDecide, false);
    assert.equal(after.run.runId, before.run.runId);
    assert.equal(after.run.state, "WAITING");
    assert.equal(after.run.humanPromptCount, 1);
    assert.equal(after.run.decision.status, "AUTHORIZED");
    assert.equal(after.run.decision.authorizedChoice, "WAIT_AND_RECHECK");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
