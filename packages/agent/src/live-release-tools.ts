import {
  QUIETOPS_GITHUB_TARGET,
  createDeploymentRevisionCollector,
  type DeploymentEvidenceBundle,
  type GitHubEvidenceBundle,
} from "@quietops/adapters";
import { tool, type InvokableTool, type JSONValue } from "@strands-agents/sdk";
import { z } from "zod";

import type { EvidenceRecorder } from "./evidence.js";
import {
  LIVE_GITHUB_EVIDENCE_TOOL_NAMES,
  createLiveGitHubEvidenceTools,
} from "./live-github-tools.js";
import { EVIDENCE_TOOL_NAMES } from "./tools.js";

const EMPTY_INPUT = z.object({}).strict();

export const QUIETOPS_LIVE_DEPLOYMENT_TARGET = Object.freeze({
  repository: QUIETOPS_GITHUB_TARGET.repository,
  markerUrl:
    "https://quietops-production.up.railway.app/.well-known/quietops-release.json",
} as const);

export const LIVE_RELEASE_EVIDENCE_TOOL_NAMES = Object.freeze([
  ...LIVE_GITHUB_EVIDENCE_TOOL_NAMES,
  EVIDENCE_TOOL_NAMES[2],
] as const);

export interface CreateLiveReleaseEvidenceToolsOptions {
  readonly githubCollector?: () => Promise<GitHubEvidenceBundle>;
  readonly deploymentCollector?: () => Promise<DeploymentEvidenceBundle>;
}

export function createLiveReleaseEvidenceTools(
  recorder: EvidenceRecorder,
  options: CreateLiveReleaseEvidenceToolsOptions = {},
): readonly InvokableTool<Record<string, never>, JSONValue>[] {
  const deploymentCollector =
    options.deploymentCollector ??
    createDeploymentRevisionCollector(QUIETOPS_LIVE_DEPLOYMENT_TARGET);

  return Object.freeze([
    ...createLiveGitHubEvidenceTools(recorder, {
      ...(options.githubCollector
        ? { collector: options.githubCollector }
        : {}),
    }),
    tool<typeof EMPTY_INPUT, JSONValue>({
      name: EVIDENCE_TOOL_NAMES[2],
      description:
        "Read the exact revision from the construction-bound QuietOps deployment marker.",
      inputSchema: EMPTY_INPUT,
      callback: async (): Promise<JSONValue> => {
        const bundle = await deploymentCollector();
        const observation = Object.freeze({
          evidenceId: bundle.deployment.evidenceId,
          kind: bundle.deployment.kind,
          status: bundle.deployment.status,
          value: bundle.deployment.value,
        });
        const receipt = Object.freeze({
          toolName: EVIDENCE_TOOL_NAMES[2],
          evidenceId: bundle.deployment.evidenceId,
          provider: "deployment-marker" as const,
          providerRecordId: bundle.deployment.value,
          sourceUrl: bundle.deployment.sourceUrl,
          fetchedAt: bundle.deployment.fetchedAt,
          externalMutations: 0 as const,
        });
        recorder.observations.push(observation);
        recorder.toolCalls.push(receipt);
        return {
          evidenceId: observation.evidenceId,
          kind: observation.kind,
          status: observation.status,
          value: observation.value,
          provider: receipt.provider,
          providerRecordId: receipt.providerRecordId,
          sourceUrl: receipt.sourceUrl,
          fetchedAt: receipt.fetchedAt,
          externalMutations: receipt.externalMutations,
        };
      },
    }),
  ]);
}
