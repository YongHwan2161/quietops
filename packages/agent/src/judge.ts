import {
  runMismatchSlice,
  runReadySlice,
  type MismatchSliceResult,
  type ReadySliceResult,
  type ReleaseSliceResult,
} from "./run-mismatch.js";
import { EVIDENCE_TOOL_NAMES } from "./tools.js";

export interface JudgeDemoResult {
  readonly status: "PASS";
  readonly scenarios: readonly [ReadySliceResult, MismatchSliceResult];
  readonly externalMutations: 0;
}

export async function runJudgeDemo(): Promise<JudgeDemoResult> {
  const ready = await runReadySlice();
  const mismatch = await runMismatchSlice();
  const scenarios = Object.freeze([ready, mismatch] as const);

  verifyJudgeDemoResults(scenarios);

  return Object.freeze({
    status: "PASS",
    scenarios,
    externalMutations: 0,
  });
}

export function verifyJudgeDemoResults(
  scenarios: readonly ReleaseSliceResult[],
): asserts scenarios is readonly [ReadySliceResult, MismatchSliceResult] {
  requireInvariant(scenarios.length === 2, "expected exactly two scenarios");

  const [ready, mismatch] = scenarios;
  requireInvariant(
    ready?.scenario === "ready",
    "Ready scenario must run first",
  );
  requireInvariant(
    mismatch?.scenario === "deployed-sha-mismatch",
    "mismatch scenario must run second",
  );
  requireInvariant(ready.policy.outcome === "Ready", "Ready policy must pass");
  requireInvariant(
    ready.policy.allowedHumanDecisions.length === 0,
    "Ready must not request a human decision",
  );
  requireInvariant(
    mismatch.policy.outcome === "Needs decision",
    "mismatch policy must request a decision",
  );
  requireInvariant(
    JSON.stringify(mismatch.policy.allowedHumanDecisions) ===
      JSON.stringify(["Reject", "Re-check requested"]),
    "mismatch must expose only the bounded human decisions",
  );

  for (const scenario of scenarios) {
    requireInvariant(
      JSON.stringify(scenario.toolCalls.map((call) => call.toolName)) ===
        JSON.stringify(EVIDENCE_TOOL_NAMES),
      `${scenario.scenario} must call each evidence tool exactly once`,
    );
    requireInvariant(
      scenario.observations.length === EVIDENCE_TOOL_NAMES.length,
      `${scenario.scenario} must preserve three observations`,
    );
    requireInvariant(
      scenario.externalMutations === 0 &&
        scenario.toolCalls.every((call) => call.externalMutations === 0),
      `${scenario.scenario} must perform zero external mutations`,
    );
  }
}

function requireInvariant(
  condition: boolean,
  reason: string,
): asserts condition {
  if (!condition) {
    throw new Error(`JUDGE_DEMO_INVARIANT_FAILED: ${reason}`);
  }
}
