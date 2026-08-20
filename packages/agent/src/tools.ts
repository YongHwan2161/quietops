import { tool, type InvokableTool, type JSONValue } from "@strands-agents/sdk";
import { z } from "zod";

import type {
  EvidenceKind,
  EvidenceObservation,
  EvidenceRecorder,
  ReleaseFixture,
} from "./evidence.js";

const EMPTY_INPUT = z.object({}).strict();

export const EVIDENCE_TOOL_NAMES = Object.freeze([
  "observe_source_revision",
  "observe_ci_status",
  "observe_deployed_revision",
] as const);

export type EvidenceToolName = (typeof EVIDENCE_TOOL_NAMES)[number];

export function createEvidenceRecorder(): EvidenceRecorder {
  return {
    observations: [],
    toolCalls: [],
  };
}

export function createEvidenceTools(
  fixture: ReleaseFixture,
  recorder: EvidenceRecorder,
): readonly InvokableTool<Record<string, never>, JSONValue>[] {
  return Object.freeze([
    observationTool(
      EVIDENCE_TOOL_NAMES[0],
      "Read the exact source commit for the release candidate.",
      "source-1",
      "Source revision",
      fixture.sourceCommit,
      recorder,
    ),
    observationTool(
      EVIDENCE_TOOL_NAMES[1],
      "Read the required CI status for the release candidate.",
      "ci-1",
      "CI status",
      fixture.ciStatus,
      recorder,
    ),
    observationTool(
      EVIDENCE_TOOL_NAMES[2],
      "Read the exact revision reported by the deployment marker.",
      "deployment-1",
      "Deployed revision",
      fixture.deployedCommit,
      recorder,
    ),
  ]);
}

function observationTool(
  name: string,
  description: string,
  evidenceId: string,
  kind: EvidenceKind,
  value: string,
  recorder: EvidenceRecorder,
): InvokableTool<Record<string, never>, JSONValue> {
  return tool<typeof EMPTY_INPUT, JSONValue>({
    name,
    description,
    inputSchema: EMPTY_INPUT,
    callback: (): JSONValue => {
      const observation: EvidenceObservation = Object.freeze({
        evidenceId,
        kind,
        status: "Verified",
        value,
      });

      recorder.observations.push(observation);
      recorder.toolCalls.push(
        Object.freeze({
          toolName: name,
          evidenceId,
          externalMutations: 0,
        }),
      );

      return {
        evidenceId: observation.evidenceId,
        kind: observation.kind,
        status: observation.status,
        value: observation.value,
      };
    },
  });
}
