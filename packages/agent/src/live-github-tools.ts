import {
  QUIETOPS_GITHUB_TARGET,
  collectGitHubSourceAndCiEvidence,
  type GitHubEvidenceBundle,
} from "@quietops/adapters";
import { tool, type InvokableTool, type JSONValue } from "@strands-agents/sdk";
import { z } from "zod";

import type {
  EvidenceObservation,
  EvidenceRecorder,
  ToolCallReceipt,
} from "./evidence.js";
import { EVIDENCE_TOOL_NAMES } from "./tools.js";

const EMPTY_INPUT = z.object({}).strict();

export const LIVE_GITHUB_EVIDENCE_TOOL_NAMES = Object.freeze([
  EVIDENCE_TOOL_NAMES[0],
  EVIDENCE_TOOL_NAMES[1],
] as const);

export interface CreateLiveGitHubEvidenceToolsOptions {
  readonly collector?: () => Promise<GitHubEvidenceBundle>;
}

export function createLiveGitHubEvidenceTools(
  recorder: EvidenceRecorder,
  options: CreateLiveGitHubEvidenceToolsOptions = {},
): readonly InvokableTool<Record<string, never>, JSONValue>[] {
  const collector =
    options.collector ??
    (() => collectGitHubSourceAndCiEvidence(QUIETOPS_GITHUB_TARGET));
  let sharedCollection: Promise<GitHubEvidenceBundle> | undefined;
  const collectOnce = (): Promise<GitHubEvidenceBundle> => {
    sharedCollection ??= collector();
    return sharedCollection;
  };

  return Object.freeze([
    tool<typeof EMPTY_INPUT, JSONValue>({
      name: LIVE_GITHUB_EVIDENCE_TOOL_NAMES[0],
      description:
        "Read the exact public GitHub source commit for the allowlisted release target.",
      inputSchema: EMPTY_INPUT,
      callback: async (): Promise<JSONValue> => {
        const bundle = await collectOnce();
        return recordGitHubObservation(
          {
            evidenceId: bundle.source.evidenceId,
            kind: bundle.source.kind,
            status: bundle.source.status,
            value: bundle.source.value,
          },
          {
            toolName: LIVE_GITHUB_EVIDENCE_TOOL_NAMES[0],
            evidenceId: bundle.source.evidenceId,
            provider: "github",
            providerRecordId: bundle.source.value,
            sourceUrl: bundle.source.sourceUrl,
            fetchedAt: bundle.source.fetchedAt,
            externalMutations: 0,
          },
          recorder,
        );
      },
    }),
    tool<typeof EMPTY_INPUT, JSONValue>({
      name: LIVE_GITHUB_EVIDENCE_TOOL_NAMES[1],
      description:
        "Read the completed required GitHub Actions result bound to the allowlisted source commit.",
      inputSchema: EMPTY_INPUT,
      callback: async (): Promise<JSONValue> => {
        const bundle = await collectOnce();
        return recordGitHubObservation(
          {
            evidenceId: bundle.ci.evidenceId,
            kind: bundle.ci.kind,
            status: bundle.ci.status,
            value: bundle.ci.value,
          },
          {
            toolName: LIVE_GITHUB_EVIDENCE_TOOL_NAMES[1],
            evidenceId: bundle.ci.evidenceId,
            provider: "github",
            providerRecordId: String(bundle.ci.runId),
            sourceUrl: bundle.ci.sourceUrl,
            fetchedAt: bundle.ci.fetchedAt,
            externalMutations: 0,
          },
          recorder,
        );
      },
    }),
  ]);
}

function recordGitHubObservation(
  observation: EvidenceObservation,
  receipt: ToolCallReceipt,
  recorder: EvidenceRecorder,
): JSONValue {
  const frozenObservation = Object.freeze({ ...observation });
  const frozenReceipt = Object.freeze({ ...receipt });
  recorder.observations.push(frozenObservation);
  recorder.toolCalls.push(frozenReceipt);
  return {
    evidenceId: frozenObservation.evidenceId,
    kind: frozenObservation.kind,
    status: frozenObservation.status,
    value: frozenObservation.value,
    provider: frozenReceipt.provider ?? "github",
    providerRecordId: frozenReceipt.providerRecordId ?? "",
    sourceUrl: frozenReceipt.sourceUrl ?? "",
    fetchedAt: frozenReceipt.fetchedAt ?? "",
    externalMutations: frozenReceipt.externalMutations,
  };
}
