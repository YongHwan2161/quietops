import type { EvaluationOutcome, HumanDecision } from "@quietops/contracts";

import type { EvidenceKind, EvidenceObservation } from "./evidence.js";

export interface PolicyDecision {
  readonly outcome: EvaluationOutcome;
  readonly reason: string;
  readonly evidenceIds: readonly string[];
  readonly allowedHumanDecisions: readonly HumanDecision[];
}

export function evaluateReleaseMismatch(
  expectedCommit: string,
  observations: readonly EvidenceObservation[],
): PolicyDecision {
  const source = requireObservation("Source revision", observations);
  const ci = requireObservation("CI status", observations);
  const deployed = requireObservation("Deployed revision", observations);
  const evidenceIds = Object.freeze([
    source.evidenceId,
    ci.evidenceId,
    deployed.evidenceId,
  ]);

  if (source.value !== expectedCommit || ci.value !== "success") {
    return Object.freeze({
      outcome: "Could not complete",
      reason: "Required source or CI evidence did not verify the candidate.",
      evidenceIds,
      allowedHumanDecisions: Object.freeze([]),
    });
  }

  if (deployed.value !== expectedCommit) {
    return Object.freeze({
      outcome: "Needs decision",
      reason: `Deployed revision ${deployed.value} does not match expected revision ${expectedCommit}.`,
      evidenceIds,
      allowedHumanDecisions: Object.freeze<HumanDecision[]>([
        "Reject",
        "Re-check requested",
      ]),
    });
  }

  return Object.freeze({
    outcome: "Ready",
    reason: "Source, CI, and deployed revision match the release candidate.",
    evidenceIds,
    allowedHumanDecisions: Object.freeze([]),
  });
}

function requireObservation(
  kind: EvidenceKind,
  observations: readonly EvidenceObservation[],
): EvidenceObservation {
  const matches = observations.filter(
    (observation) =>
      observation.kind === kind && observation.status === "Verified",
  );

  if (matches.length !== 1) {
    throw new Error(`Expected exactly one verified ${kind} observation.`);
  }

  return matches[0]!;
}
