import assert from "node:assert/strict";
import test from "node:test";

import type {
  DeploymentEvidenceBundle,
  GitHubEvidenceBundle,
} from "@quietops/adapters";

import {
  LIVE_RELEASE_EVIDENCE_TOOL_NAMES,
  runLiveReleaseVerification,
} from "../src/index.js";
import { ScriptedEvidenceModel } from "../src/scripted-model.js";

const COMMIT = "294a5eb04e9667c797aa7a316d5896c84a4342a1";
const MARKER_URL =
  "https://quietops-production.up.railway.app/.well-known/quietops-release.json";

test("binds live source, CI, and deployment evidence through three Strands tools", async () => {
  let githubCollections = 0;
  let deploymentCollections = 0;
  const result = await runLiveReleaseVerification({
    modelMode: "injected-test",
    githubCollector: async () => {
      githubCollections += 1;
      return githubBundle();
    },
    deploymentCollector: async () => {
      deploymentCollections += 1;
      return deploymentBundle();
    },
  });

  assert.equal(githubCollections, 1);
  assert.equal(deploymentCollections, 1);
  assert.equal(result.scenario, "live-release-verification");
  assert.equal(result.agentRuntime, "@strands-agents/sdk");
  assert.equal(result.modelMode, "injected-test");
  assert.deepEqual(
    result.toolCalls.map((call) => call.toolName),
    LIVE_RELEASE_EVIDENCE_TOOL_NAMES,
  );
  assert.deepEqual(
    result.observations.map((observation) => observation.kind),
    ["Source revision", "CI status", "Deployed revision"],
  );
  assert.equal(result.toolCalls[2]?.provider, "deployment-marker");
  assert.equal(result.toolCalls[2]?.sourceUrl, MARKER_URL);
  assert.equal(result.candidate.commit, COMMIT);
  assert.equal(
    result.candidate.deploymentUrl,
    "https://quietops-production.up.railway.app",
  );
  assert.equal(result.policy.outcome, "Ready");
  assert.deepEqual(result.policy.allowedHumanDecisions, []);
  assert.equal(result.externalMutations, 0);
});

test("refuses to label the scripted test model as Bedrock live proof", async () => {
  await assert.rejects(
    runLiveReleaseVerification({
      model: new ScriptedEvidenceModel(LIVE_RELEASE_EVIDENCE_TOOL_NAMES),
      modelMode: "bedrock-live",
      githubCollector: async () => githubBundle(),
      deploymentCollector: async () => deploymentBundle(),
    }),
    /bedrock-live mode refuses the scripted test model/,
  );
});

function githubBundle(): GitHubEvidenceBundle {
  const fetchedAt = "2026-08-23T06:00:00.000Z";
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
      completedAt: "2026-08-23T05:59:00Z",
    }),
    externalMutations: 0,
  });
}

function deploymentBundle(): DeploymentEvidenceBundle {
  return Object.freeze({
    target: Object.freeze({
      repository: "YongHwan2161/quietops",
      markerUrl: MARKER_URL,
    }),
    deployment: Object.freeze({
      evidenceId: `deployment-marker:${COMMIT}`,
      kind: "Deployed revision",
      status: "Verified",
      value: COMMIT,
      sourceUrl: MARKER_URL,
      fetchedAt: "2026-08-23T06:00:01.000Z",
    }),
    externalMutations: 0,
  });
}
