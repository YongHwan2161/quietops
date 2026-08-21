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
  const source = findObservation("Source revision", observations);
  const ci = findObservation("CI status", observations);
  const deployed = findObservation("Deployed revision", observations);
  const evidenceIds = Object.freeze(
    [source, ci, deployed]
      .filter((observation) => observation !== undefined)
      .map((observation) => observation.evidenceId),
  );

  if (
    (source !== undefined && source.value !== expectedCommit) ||
    (ci !== undefined && ci.value !== "success")
  ) {
    return Object.freeze({
      outcome: "Could not complete",
      reason: "Required source or CI evidence did not verify the candidate.",
      evidenceIds,
      allowedHumanDecisions: Object.freeze([]),
    });
  }

  const missingKinds = [
    ...(source === undefined ? ["Source revision"] : []),
    ...(ci === undefined ? ["CI status"] : []),
    ...(deployed === undefined ? ["Deployed revision"] : []),
  ];
  if (source === undefined || ci === undefined || deployed === undefined) {
    return Object.freeze({
      outcome: "Could not complete",
      reason: `Required evidence is incomplete: missing ${missingKinds.join(
        ", ",
      )}.`,
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

function findObservation(
  kind: EvidenceKind,
  observations: readonly EvidenceObservation[],
): EvidenceObservation | undefined {
  const matches = observations.filter(
    (observation) =>
      observation.kind === kind && observation.status === "Verified",
  );

  if (matches.length > 1) {
    throw new Error(
      `Expected exactly one verified ${kind} observation; received multiple.`,
    );
  }

  return matches[0];
}
