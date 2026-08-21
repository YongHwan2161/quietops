import {
  QUIETOPS_GITHUB_TARGET,
  type GitHubEvidenceBundle,
} from "@quietops/adapters";
import { Agent } from "@strands-agents/sdk";

import type { ReleaseSliceResult } from "./run-mismatch.js";
import { evaluateReleaseMismatch } from "./policy.js";
import { ScriptedEvidenceModel } from "./scripted-model.js";
import { EvidenceToolBudget } from "./tool-budget.js";
import {
  LIVE_GITHUB_EVIDENCE_TOOL_NAMES,
  createLiveGitHubEvidenceTools,
} from "./live-github-tools.js";
import { createEvidenceRecorder } from "./tools.js";
import { STRANDS_SDK_VERSION } from "./run-mismatch.js";

export interface LiveGitHubSourceCiSliceResult extends ReleaseSliceResult<"live-github-source-ci"> {
  readonly candidate: {
    readonly repository: typeof QUIETOPS_GITHUB_TARGET.repository;
    readonly branch: typeof QUIETOPS_GITHUB_TARGET.ref;
    readonly commit: string;
  };
}

export interface RunLiveGitHubSourceCiOptions {
  readonly collector?: () => Promise<GitHubEvidenceBundle>;
}

export async function runLiveGitHubSourceCiSlice(
  options: RunLiveGitHubSourceCiOptions = {},
): Promise<LiveGitHubSourceCiSliceResult> {
  const recorder = createEvidenceRecorder();
  const model = new ScriptedEvidenceModel(
    LIVE_GITHUB_EVIDENCE_TOOL_NAMES,
    "Source and CI evidence collected. Deployment evidence remains unavailable.",
  );
  const agent = new Agent({
    model,
    plugins: [new EvidenceToolBudget(LIVE_GITHUB_EVIDENCE_TOOL_NAMES)],
    tools: [
      ...createLiveGitHubEvidenceTools(recorder, {
        ...(options.collector ? { collector: options.collector } : {}),
      }),
    ],
    toolExecutor: "sequential",
    printer: false,
    systemPrompt:
      "Call each registered read-only GitHub evidence tool exactly once. Do not call any other tool. Do not claim release readiness because deployment evidence is unavailable and deterministic policy is authoritative.",
  });

  const agentResult = await agent.invoke(
    `Collect source and CI evidence for ${QUIETOPS_GITHUB_TARGET.repository} ${QUIETOPS_GITHUB_TARGET.ref}.`,
  );
  const source = recorder.observations.find(
    (observation) => observation.kind === "Source revision",
  );
  if (!source)
    throw new Error("The live GitHub source observation is missing.");
  const policy = evaluateReleaseMismatch(source.value, recorder.observations);

  return Object.freeze({
    scenario: "live-github-source-ci",
    agentRuntime: "@strands-agents/sdk",
    agentRuntimeVersion: STRANDS_SDK_VERSION,
    modelMode: "github-public-read-only-scripted",
    modelNarration: agentResult.toString(),
    candidate: Object.freeze({
      repository: QUIETOPS_GITHUB_TARGET.repository,
      branch: QUIETOPS_GITHUB_TARGET.ref,
      commit: source.value,
    }),
    policy,
    observations: Object.freeze([...recorder.observations]),
    toolCalls: Object.freeze([...recorder.toolCalls]),
    externalMutations: 0,
  });
}
