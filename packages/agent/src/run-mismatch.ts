import { Agent, type Model } from "@strands-agents/sdk";

import {
  MISMATCH_FIXTURE,
  READY_FIXTURE,
  type EvidenceObservation,
  type FixtureReleaseScenario,
  type ReleaseFixture,
  type ReleaseScenario,
  type ToolCallReceipt,
} from "./evidence.js";
import { evaluateReleaseMismatch, type PolicyDecision } from "./policy.js";
import { ScriptedEvidenceModel } from "./scripted-model.js";
import { EvidenceToolBudget } from "./tool-budget.js";
import { createEvidenceRecorder, createEvidenceTools } from "./tools.js";

export const STRANDS_SDK_VERSION = "1.13.0" as const;

export type MismatchModelMode =
  | "credential-free-scripted"
  | "bedrock-live"
  | "injected-test"
  | "github-public-read-only-scripted";

export type RunMismatchOptions =
  | {
      readonly model?: never;
      readonly modelMode?: "credential-free-scripted";
    }
  | {
      readonly model: Model;
      readonly modelMode: "bedrock-live";
    };

export interface ReleaseSliceResult<
  Scenario extends ReleaseScenario = ReleaseScenario,
> {
  readonly scenario: Scenario;
  readonly agentRuntime: "@strands-agents/sdk";
  readonly agentRuntimeVersion: typeof STRANDS_SDK_VERSION;
  readonly modelMode: MismatchModelMode;
  readonly modelNarration: string;
  readonly policy: PolicyDecision;
  readonly observations: readonly EvidenceObservation[];
  readonly toolCalls: readonly ToolCallReceipt[];
  readonly externalMutations: 0;
}

export type MismatchSliceResult = ReleaseSliceResult<"deployed-sha-mismatch">;
export type ReadySliceResult = ReleaseSliceResult<"ready">;

export async function runMismatchSlice(
  options: RunMismatchOptions = {},
): Promise<MismatchSliceResult> {
  return runReleaseSlice(MISMATCH_FIXTURE, options);
}

export async function runReadySlice(): Promise<ReadySliceResult> {
  return runReleaseSlice(READY_FIXTURE, {});
}

export async function runReleaseSlice<Scenario extends FixtureReleaseScenario>(
  fixture: ReleaseFixture<Scenario>,
  options: RunMismatchOptions = {},
): Promise<ReleaseSliceResult<Scenario>> {
  const recorder = createEvidenceRecorder();
  const model = options.model ?? new ScriptedEvidenceModel();
  const modelMode = options.modelMode ?? "credential-free-scripted";
  const agent = new Agent({
    model,
    plugins: [new EvidenceToolBudget()],
    tools: [...createEvidenceTools(fixture, recorder)],
    toolExecutor: "sequential",
    printer: false,
    systemPrompt:
      "Call each of the three registered read-only evidence tools exactly once. Do not call any other tool. Summarize the observations, but do not decide release readiness because deterministic policy is authoritative.",
  });

  const agentResult = await agent.invoke(
    `Evaluate release candidate ${fixture.expectedCommit}.`,
  );
  const policy = evaluateReleaseMismatch(
    fixture.expectedCommit,
    recorder.observations,
  );

  return Object.freeze({
    scenario: fixture.scenario,
    agentRuntime: "@strands-agents/sdk",
    agentRuntimeVersion: STRANDS_SDK_VERSION,
    modelMode,
    modelNarration: agentResult.toString(),
    policy,
    observations: Object.freeze([...recorder.observations]),
    toolCalls: Object.freeze([...recorder.toolCalls]),
    externalMutations: 0,
  });
}
