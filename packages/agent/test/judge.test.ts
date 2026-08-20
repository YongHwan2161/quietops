import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EVIDENCE_TOOL_NAMES,
  READY_FIXTURE,
  runJudgeDemo,
  runReadySlice,
  verifyJudgeDemoResults,
} from "../src/index.js";

describe("credential-free judge demo", () => {
  it("passes a matching release without requesting human attention", async () => {
    const result = await runReadySlice();

    assert.equal(result.scenario, "ready");
    assert.equal(result.policy.outcome, "Ready");
    assert.deepEqual(result.policy.allowedHumanDecisions, []);
    assert.equal(result.observations[0]?.value, READY_FIXTURE.sourceCommit);
    assert.deepEqual(
      result.toolCalls.map((call) => call.toolName),
      EVIDENCE_TOOL_NAMES,
    );
    assert.equal(result.externalMutations, 0);
  });

  it("runs Ready then mismatch and verifies the contrast", async () => {
    const result = await runJudgeDemo();

    assert.equal(result.status, "PASS");
    assert.deepEqual(
      result.scenarios.map((scenario) => scenario.scenario),
      ["ready", "deployed-sha-mismatch"],
    );
    assert.deepEqual(
      result.scenarios.map((scenario) => scenario.policy.outcome),
      ["Ready", "Needs decision"],
    );
    assert.equal(result.externalMutations, 0);
  });

  it("fails closed when judge scenario ordering is changed", async () => {
    const result = await runJudgeDemo();

    assert.throws(
      () => verifyJudgeDemoResults([...result.scenarios].reverse()),
      /JUDGE_DEMO_INVARIANT_FAILED: Ready scenario must run first/,
    );
  });
});
