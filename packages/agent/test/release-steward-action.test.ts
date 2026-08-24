import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildGitHubIncidentPlan,
  type GitHubIncidentContext,
} from "@quietops/adapters";

import {
  RELEASE_STEWARD_TOOL_NAMES,
  runReleaseStewardIncidentAction,
} from "../src/index.js";
import { ScriptedEvidenceModel } from "../src/scripted-model.js";

const CANDIDATE = "26875fb2f1eff59fef7d8fbf5b02d5c5dd505b72";

describe("authorized Strands incident action", () => {
  it("exposes one immutable tool and returns one confirmed provider receipt", async () => {
    const plan = buildGitHubIncidentPlan(context());
    let calls = 0;
    const result = await runReleaseStewardIncidentAction({
      plan,
      modelMode: "injected-test",
      model: new ScriptedEvidenceModel([RELEASE_STEWARD_TOOL_NAMES.incident]),
      executeIncident: async (received) => {
        calls += 1;
        assert.deepEqual(received, plan);
        return Object.freeze({
          status: "CONFIRMED",
          providerRecordId: "42",
          providerUrl: "https://github.com/YongHwan2161/quietops/issues/42",
          responseDigest: "a".repeat(64),
          externalWriteAttempts: 1,
        });
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.phase, "ESCALATION_RESUME");
    assert.equal(result.action.status, "CONFIRMED");
    assert.equal(result.requestFingerprint, plan.requestFingerprint);
    assert.deepEqual(result.toolCallCounts, { create_github_incident: 1 });
    assert.equal(result.externalWriteAttempts, 1);
  });

  it("fails closed when the model skips or duplicates the one-call budget", async () => {
    const plan = buildGitHubIncidentPlan(context());
    let calls = 0;
    const executeIncident = async () => {
      calls += 1;
      return Object.freeze({
        status: "UNCERTAIN" as const,
        providerRecordId: null,
        providerUrl: null,
        responseDigest: null,
        externalWriteAttempts: 1 as const,
      });
    };
    await assert.rejects(
      runReleaseStewardIncidentAction({
        plan,
        modelMode: "injected-test",
        model: new ScriptedEvidenceModel([]),
        executeIncident,
      }),
      /did not execute exactly one/,
    );
    assert.equal(calls, 0);

    await assert.rejects(
      runReleaseStewardIncidentAction({
        plan,
        modelMode: "injected-test",
        model: new ScriptedEvidenceModel([
          RELEASE_STEWARD_TOOL_NAMES.incident,
          RELEASE_STEWARD_TOOL_NAMES.incident,
        ]),
        executeIncident,
      }),
      /tool-budget violation/,
    );
    assert.equal(calls, 1);
  });
});

function context(): GitHubIncidentContext {
  return {
    runId: "run-agent-item-8",
    candidateCommit: CANDIDATE,
    decisionId: "decision-agent-item-8",
    authorizedAt: "2026-08-24T10:00:00.000Z",
    observationCount: 2,
    measuredWaitMs: 5_000,
    evidence: {
      source: link(
        `github-commit:${CANDIDATE}`,
        `https://github.com/YongHwan2161/quietops/commit/${CANDIDATE}`,
      ),
      ci: link(
        "github-actions-run:32718604234",
        "https://github.com/YongHwan2161/quietops/actions/runs/32718604234",
      ),
      deployment: link(
        "deployment-marker:old-release",
        "https://quietops-production.up.railway.app/.well-known/quietops-release.json",
      ),
      homepageSmoke: link(
        "homepage-smoke:healthy",
        "https://quietops-production.up.railway.app/",
      ),
    },
  };
}

function link(evidenceId: string, sourceUrl: string) {
  return Object.freeze({
    evidenceId,
    sourceUrl,
    fetchedAt: "2026-08-24T09:59:59.000Z",
  });
}
