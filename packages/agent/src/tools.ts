import { tool, type InvokableTool, type JSONValue } from "@strands-agents/sdk";
import { z } from "zod";

import type {
  EvidenceKind,
  EvidenceObservation,
  EvidenceRecorder,
  MismatchFixture,
} from "./evidence.js";

const EMPTY_INPUT = z.object({}).strict();

export function createEvidenceRecorder(): EvidenceRecorder {
  return {
    observations: [],
    toolCalls: [],
  };
}

export function createEvidenceTools(
  fixture: MismatchFixture,
  recorder: EvidenceRecorder,
): readonly InvokableTool<Record<string, never>, JSONValue>[] {
  return Object.freeze([
    observationTool(
      "observe_source_revision",
      "Read the exact source commit for the release candidate.",
      "source-1",
      "Source revision",
      fixture.sourceCommit,
      recorder,
    ),
    observationTool(
      "observe_ci_status",
      "Read the required CI status for the release candidate.",
      "ci-1",
      "CI status",
      fixture.ciStatus,
      recorder,
    ),
    observationTool(
      "observe_deployed_revision",
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
