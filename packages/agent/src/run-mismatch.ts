import { Agent, type Model } from "@strands-agents/sdk";

import {
  MISMATCH_FIXTURE,
  type EvidenceObservation,
  type ToolCallReceipt,
} from "./evidence.js";
import { evaluateReleaseMismatch, type PolicyDecision } from "./policy.js";
import { ScriptedEvidenceModel } from "./scripted-model.js";
import { EvidenceToolBudget } from "./tool-budget.js";
import { createEvidenceRecorder, createEvidenceTools } from "./tools.js";

export const STRANDS_SDK_VERSION = "1.13.0" as const;

export type MismatchModelMode = "credential-free-scripted" | "bedrock-live";

export type RunMismatchOptions =
  | {
      readonly model?: never;
      readonly modelMode?: "credential-free-scripted";
    }
  | {
      readonly model: Model;
      readonly modelMode: "bedrock-live";
    };

export interface MismatchSliceResult {
  readonly scenario: "deployed-sha-mismatch";
  readonly agentRuntime: "@strands-agents/sdk";
  readonly agentRuntimeVersion: typeof STRANDS_SDK_VERSION;
  readonly modelMode: MismatchModelMode;
  readonly modelNarration: string;
  readonly policy: PolicyDecision;
  readonly observations: readonly EvidenceObservation[];
  readonly toolCalls: readonly ToolCallReceipt[];
  readonly externalMutations: 0;
}

export async function runMismatchSlice(
  options: RunMismatchOptions = {},
): Promise<MismatchSliceResult> {
  const recorder = createEvidenceRecorder();
  const model = options.model ?? new ScriptedEvidenceModel();
  const modelMode = options.modelMode ?? "credential-free-scripted";
  const agent = new Agent({
    model,
    plugins: [new EvidenceToolBudget()],
    tools: [...createEvidenceTools(MISMATCH_FIXTURE, recorder)],
    toolExecutor: "sequential",
    printer: false,
    systemPrompt:
      "Call each of the three registered read-only evidence tools exactly once. Do not call any other tool. Summarize the observations, but do not decide release readiness because deterministic policy is authoritative.",
  });

  const agentResult = await agent.invoke(
    `Evaluate release candidate ${MISMATCH_FIXTURE.expectedCommit}.`,
  );
  const policy = evaluateReleaseMismatch(
    MISMATCH_FIXTURE.expectedCommit,
    recorder.observations,
  );

  return Object.freeze({
    scenario: "deployed-sha-mismatch",
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
