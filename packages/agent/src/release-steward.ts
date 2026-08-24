import { Agent, type Model } from "@strands-agents/sdk";

import { STRANDS_SDK_VERSION } from "./run-mismatch.js";
import {
  validateReleaseStewardPostconditions,
  type ReleaseStewardPostcondition,
} from "./release-steward-policy.js";
import { ReleaseStewardToolBudget } from "./release-steward-tool-budget.js";
import {
  createReleaseStewardRecorder,
  createReleaseStewardTools,
  releaseStewardToolNamesForPhase,
  type CreateReleaseStewardToolsOptions,
  type ReleaseStewardEvidence,
  type ReleaseStewardObservationPhase,
  type ReleaseStewardToolReceipt,
} from "./release-steward-tools.js";

export interface RunReleaseStewardObservationOptions extends CreateReleaseStewardToolsOptions {
  readonly phase: ReleaseStewardObservationPhase;
  readonly candidateCommit: string;
  readonly immutableEvidenceIds?: {
    readonly source: string;
    readonly ci: string;
  };
  readonly model: Model;
  readonly modelMode: "bedrock-live" | "injected-test";
}

export interface ReleaseStewardObservationResult {
  readonly agentRuntime: "@strands-agents/sdk";
  readonly agentRuntimeVersion: typeof STRANDS_SDK_VERSION;
  readonly modelMode: "bedrock-live" | "injected-test";
  readonly phase: ReleaseStewardObservationPhase;
  readonly modelNarration: string;
  readonly postcondition: Readonly<ReleaseStewardPostcondition>;
  readonly evidence: readonly ReleaseStewardEvidence[];
  readonly receipts: readonly ReleaseStewardToolReceipt[];
  readonly toolCallCounts: Readonly<Record<string, number>>;
  readonly externalMutations: 0;
}

export async function runReleaseStewardObservation(
  options: RunReleaseStewardObservationOptions,
): Promise<Readonly<ReleaseStewardObservationResult>> {
  if (!options.model) {
    throw new Error(
      "Release steward live/test model injection is required; no scripted fallback exists.",
    );
  }
  if (
    options.modelMode === "bedrock-live" &&
    options.model.getConfig().modelId ===
      "quietops-credential-free-scripted-model"
  ) {
    throw new Error(
      "Release steward bedrock-live mode refuses the preserved scripted demonstration model.",
    );
  }
  const recorder = createReleaseStewardRecorder();
  const budget = new ReleaseStewardToolBudget(options.phase);
  const toolNames = releaseStewardToolNamesForPhase(options.phase);
  const agent = new Agent({
    model: options.model,
    plugins: [budget],
    tools: [
      ...createReleaseStewardTools(options.phase, recorder, {
        ...(options.githubCollector
          ? { githubCollector: options.githubCollector }
          : {}),
        ...(options.deploymentCollector
          ? { deploymentCollector: options.deploymentCollector }
          : {}),
        ...(options.homepageCollector
          ? { homepageCollector: options.homepageCollector }
          : {}),
        ...(options.recheckProposal
          ? { recheckProposal: options.recheckProposal }
          : {}),
      }),
    ],
    toolExecutor: "sequential",
    printer: false,
    systemPrompt:
      `Call only these registered tools, in order when applicable: ${toolNames.join(", ")}. ` +
      "Every deployment observation must be followed immediately by homepage smoke. " +
      "Schedule a recheck only when the deployment revision is old. " +
      "Summarize observations, but never choose the state transition; deterministic policy is authoritative.",
  });

  const agentResult = await agent.invoke(
    `Observe release candidate ${options.candidateCommit} in phase ${options.phase}.`,
  );
  budget.assertNoViolations();
  const modelNarration = agentResult.toString();
  const postcondition = validateReleaseStewardPostconditions({
    phase: options.phase,
    candidateCommit: options.candidateCommit,
    evidence: recorder.evidence,
    receipts: recorder.receipts,
    ...(options.immutableEvidenceIds
      ? { immutableEvidenceIds: options.immutableEvidenceIds }
      : {}),
    modelNarration,
  });

  return Object.freeze({
    agentRuntime: "@strands-agents/sdk",
    agentRuntimeVersion: STRANDS_SDK_VERSION,
    modelMode: options.modelMode,
    phase: options.phase,
    modelNarration,
    postcondition,
    evidence: Object.freeze([...recorder.evidence]),
    receipts: Object.freeze([...recorder.receipts]),
    toolCallCounts: budget.callCounts(),
    externalMutations: 0,
  });
}
