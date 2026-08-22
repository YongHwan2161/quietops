import assert from "node:assert/strict";
import test from "node:test";

import type { GitHubEvidenceBundle } from "@quietops/adapters";

import {
  LIVE_GITHUB_EVIDENCE_TOOL_NAMES,
  runLiveGitHubSourceCiSlice,
} from "../src/index.js";

const COMMIT = "294a5eb04e9667c797aa7a316d5896c84a4342a1";

test("runs one shared public GitHub collection through two bounded Strands tools", async () => {
  let collectionCount = 0;
  const result = await runLiveGitHubSourceCiSlice({
    collector: async () => {
      collectionCount += 1;
      return githubBundle();
    },
  });

  assert.equal(collectionCount, 1);
  assert.equal(result.scenario, "live-github-source-ci");
  assert.equal(result.agentRuntime, "@strands-agents/sdk");
  assert.equal(result.modelMode, "github-public-read-only-scripted");
  assert.deepEqual(
    result.toolCalls.map((call) => call.toolName),
    LIVE_GITHUB_EVIDENCE_TOOL_NAMES,
  );
  assert.deepEqual(
    result.observations.map((observation) => observation.kind),
    ["Source revision", "CI status"],
  );
  assert.equal(
    result.toolCalls.every(
      (call) =>
        call.provider === "github" &&
        call.sourceUrl?.startsWith("https://github.com/") &&
        call.externalMutations === 0,
    ),
    true,
  );
  assert.equal(result.candidate.commit, COMMIT);
  assert.equal(result.policy.outcome, "Could not complete");
  assert.match(result.policy.reason, /missing Deployed revision/);
  assert.deepEqual(result.policy.allowedHumanDecisions, []);
  assert.equal(result.externalMutations, 0);
});

function githubBundle(): GitHubEvidenceBundle {
  const fetchedAt = "2026-08-21T15:30:00.000Z";
  return Object.freeze({
    target: Object.freeze({
      repository: "YongHwan2161/quietops",
      ref: "main",
      requiredWorkflow: "Verify",
    }),
    source: Object.freeze({
      evidenceId: `github-commit:${COMMIT}`,
      kind: "Source revision",
      status: "Verified",
      value: COMMIT,
      sourceUrl: `https://github.com/YongHwan2161/quietops/commit/${COMMIT}`,
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
      headSha: COMMIT,
      completedAt: "2026-08-21T09:33:29Z",
    }),
    externalMutations: 0,
  });
}
