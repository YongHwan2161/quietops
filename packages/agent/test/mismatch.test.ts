import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BEDROCK_CONFIGURATION_HOLD,
  BedrockConfigurationError,
  EvidenceToolBudget,
  MISMATCH_FIXTURE,
  createBedrockMismatchModel,
  evaluateReleaseMismatch,
  readBedrockMismatchConfiguration,
  runMismatchSlice,
} from "../src/index.js";

describe("Strands deployed-SHA mismatch slice", () => {
  it("executes three bounded read-only tools through the Strands agent loop", async () => {
    const result = await runMismatchSlice();

    assert.equal(result.agentRuntime, "@strands-agents/sdk");
    assert.equal(result.agentRuntimeVersion, "1.13.0");
    assert.equal(result.modelMode, "credential-free-scripted");
    assert.deepEqual(
      result.toolCalls.map((call) => call.toolName),
      [
        "observe_source_revision",
        "observe_ci_status",
        "observe_deployed_revision",
      ],
    );
    assert.deepEqual(
      result.toolCalls.map((call) => call.evidenceId),
      ["source-1", "ci-1", "deployment-1"],
    );
    assert.equal(result.observations.length, 3);
    assert.equal(result.externalMutations, 0);
    assert.equal(
      result.toolCalls.every((call) => call.externalMutations === 0),
      true,
    );
  });

  it("refuses Ready when deployed revision differs, regardless of narration", async () => {
    const result = await runMismatchSlice();

    assert.match(result.modelNarration, /Ready/);
    assert.equal(result.policy.outcome, "Needs decision");
    assert.match(result.policy.reason, /does not match/);
    assert.deepEqual(result.policy.allowedHumanDecisions, [
      "Reject",
      "Re-check requested",
    ]);
  });

  it("fails closed when required evidence is duplicated", () => {
    const source = {
      evidenceId: "source-1",
      kind: "Source revision",
      status: "Verified",
      value: MISMATCH_FIXTURE.sourceCommit,
    } as const;

    assert.throws(
      () =>
        evaluateReleaseMismatch(MISMATCH_FIXTURE.expectedCommit, [
          source,
          { ...source, evidenceId: "source-2" },
          {
            evidenceId: "ci-1",
            kind: "CI status",
            status: "Verified",
            value: "success",
          },
          {
            evidenceId: "deployment-1",
            kind: "Deployed revision",
            status: "Verified",
            value: MISMATCH_FIXTURE.deployedCommit,
          },
        ]),
      /exactly one verified Source revision/,
    );
  });

  it("fails closed before model construction when Bedrock settings are absent", () => {
    assert.throws(
      () => createBedrockMismatchModel({}),
      (error: unknown) => {
        assert.equal(error instanceof BedrockConfigurationError, true);
        assert.equal(
          (error as BedrockConfigurationError).code,
          BEDROCK_CONFIGURATION_HOLD,
        );
        assert.deepEqual((error as BedrockConfigurationError).missing, [
          "AWS_REGION",
          "QUIETOPS_MODEL_ID",
        ]);
        return true;
      },
    );
  });

  it("constructs the configured Bedrock model without invoking it", () => {
    const configuration = readBedrockMismatchConfiguration({
      AWS_REGION: " us-west-2 ",
      QUIETOPS_MODEL_ID: " example.model-v1 ",
    });
    const model = createBedrockMismatchModel({
      AWS_REGION: configuration.region,
      QUIETOPS_MODEL_ID: configuration.modelId,
    });

    assert.deepEqual(configuration, {
      region: "us-west-2",
      modelId: "example.model-v1",
    });
    assert.equal(model.getConfig().modelId, "example.model-v1");
  });

  it("rejects duplicate and non-allowlisted tool calls within one invocation", () => {
    const budget = new EvidenceToolBudget();

    assert.equal(budget.checkAndRecord("observe_source_revision"), undefined);
    assert.match(
      budget.checkAndRecord("observe_source_revision") ?? "",
      /one-call budget/,
    );
    assert.match(
      budget.checkAndRecord("deploy_release") ?? "",
      /outside the QuietOps evidence allowlist/,
    );

    budget.reset();
    assert.equal(budget.checkAndRecord("observe_source_revision"), undefined);
  });
});
