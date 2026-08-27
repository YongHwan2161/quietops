import {
  QUIETOPS_GITHUB_TARGET,
  type DeploymentEvidenceBundle,
  type GitHubEvidenceBundle,
} from "@quietops/adapters";
import { Agent, type Model } from "@strands-agents/sdk";

import type { ReleaseSliceResult } from "./run-mismatch.js";
import { evaluateReleaseMismatch } from "./policy.js";
import { ScriptedEvidenceModel } from "./scripted-model.js";
import { EvidenceToolBudget } from "./tool-budget.js";
import {
  LIVE_RELEASE_EVIDENCE_TOOL_NAMES,
  createLiveReleaseEvidenceTools,
} from "./live-release-tools.js";
import { STRANDS_SDK_VERSION } from "./run-mismatch.js";
import { createEvidenceRecorder } from "./tools.js";

export interface LiveReleaseVerificationResult extends ReleaseSliceResult<"live-release-verification"> {
  readonly candidate: {
    readonly repository: typeof QUIETOPS_GITHUB_TARGET.repository;
    readonly branch: typeof QUIETOPS_GITHUB_TARGET.ref;
    readonly commit: string;
    readonly deploymentUrl: string;
  };
}

interface LiveReleaseVerificationCollectors {
  readonly githubCollector?: () => Promise<GitHubEvidenceBundle>;
  readonly deploymentCollector?: () => Promise<DeploymentEvidenceBundle>;
}

export type RunLiveReleaseVerificationOptions =
  LiveReleaseVerificationCollectors &
    (
      | {
          readonly model?: Model;
          readonly modelMode: "injected-test";
        }
      | {
          readonly model: Model;
          readonly modelMode: "bedrock-live";
        }
    );

export async function runLiveReleaseVerification(
  options: RunLiveReleaseVerificationOptions,
): Promise<LiveReleaseVerificationResult> {
  if (
    options.modelMode === "bedrock-live" &&
    options.model.getConfig().modelId ===
      "quietops-credential-free-scripted-model"
  ) {
    throw new Error(
      "Live release bedrock-live mode refuses the scripted test model.",
    );
  }
  const recorder = createEvidenceRecorder();
  const model =
    options.model ??
    new ScriptedEvidenceModel(
      LIVE_RELEASE_EVIDENCE_TOOL_NAMES,
      "Source, required CI, and deployed revision evidence collected. Deterministic release policy is authoritative.",
    );
  const agent = new Agent({
    model,
    plugins: [new EvidenceToolBudget(LIVE_RELEASE_EVIDENCE_TOOL_NAMES)],
    tools: [...createLiveReleaseEvidenceTools(recorder, options)],
    toolExecutor: "sequential",
    printer: false,
    systemPrompt:
      "Call each registered read-only release evidence tool exactly once. Do not call any other tool. Summarize the evidence chain, but do not decide release readiness because deterministic policy is authoritative.",
  });

  const agentResult = await agent.invoke(
    `Verify the live release identity chain for ${QUIETOPS_GITHUB_TARGET.repository} ${QUIETOPS_GITHUB_TARGET.ref}.`,
  );
  const source = recorder.observations.find(
    (observation) => observation.kind === "Source revision",
  );
  const deploymentReceipt = recorder.toolCalls.find(
    (call) => call.provider === "deployment-marker",
  );
  if (!source) throw new Error("The live source observation is missing.");
  if (!deploymentReceipt?.sourceUrl) {
    throw new Error("The live deployment receipt is missing.");
  }
  const policy = evaluateReleaseMismatch(source.value, recorder.observations);

  return Object.freeze({
    scenario: "live-release-verification",
    agentRuntime: "@strands-agents/sdk",
    agentRuntimeVersion: STRANDS_SDK_VERSION,
    modelMode: options.modelMode,
    modelNarration: agentResult.toString(),
    candidate: Object.freeze({
      repository: QUIETOPS_GITHUB_TARGET.repository,
      branch: QUIETOPS_GITHUB_TARGET.ref,
      commit: source.value,
      deploymentUrl: new URL(deploymentReceipt.sourceUrl).origin,
    }),
    policy,
    observations: Object.freeze([...recorder.observations]),
    toolCalls: Object.freeze([...recorder.toolCalls]),
    externalMutations: 0,
  });
}
