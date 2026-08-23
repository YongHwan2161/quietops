import type { ReleaseRunSignal } from "@quietops/contracts";

import {
  RELEASE_STEWARD_TOOL_NAMES,
  releaseStewardToolNamesForPhase,
  type ReleaseStewardEvidence,
  type ReleaseStewardObservationPhase,
  type ReleaseStewardToolName,
  type ReleaseStewardToolReceipt,
} from "./release-steward-tools.js";

const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export interface ReleaseStewardPostconditionInput {
  readonly phase: ReleaseStewardObservationPhase;
  readonly candidateCommit: string;
  readonly evidence: readonly ReleaseStewardEvidence[];
  readonly receipts: readonly ReleaseStewardToolReceipt[];
  readonly immutableEvidenceIds?: {
    readonly source: string;
    readonly ci: string;
  };
  readonly modelNarration?: string;
}

export interface ReleaseStewardPostcondition {
  readonly signal: Extract<
    ReleaseRunSignal,
    | "REQUIRED_CI_FAILED"
    | "EVIDENCE_INVALID"
    | "CANDIDATE_READY"
    | "NORMAL_WAIT_REQUIRED"
    | "EXTENSION_READY"
    | "EXTENSION_EXHAUSTED"
  >;
  readonly candidateCommit: string;
  readonly sourceEvidenceId: string;
  readonly ciEvidenceId: string;
  readonly deploymentEvidenceId: string;
  readonly homepageSmokeEvidenceId: string;
  readonly recheckEvidenceId?: string;
  readonly externalMutations: 0;
}

export class ReleaseStewardPostconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseStewardPostconditionError";
  }
}

export function validateReleaseStewardPostconditions(
  input: ReleaseStewardPostconditionInput,
): Readonly<ReleaseStewardPostcondition> {
  if (!FULL_COMMIT_PATTERN.test(input.candidateCommit)) {
    throw invalid("Candidate commit must be one full lowercase SHA.");
  }
  assertReceiptBindings(input.evidence, input.receipts);
  assertReceiptSequence(input.phase, input.receipts);

  const source =
    input.phase === "FIRST_OBSERVATION"
      ? requireEvidence(input.evidence, "Source revision")
      : undefined;
  const ci =
    input.phase === "FIRST_OBSERVATION"
      ? requireEvidence(input.evidence, "CI status")
      : undefined;
  const deployment = requireEvidence(input.evidence, "Deployed revision");
  const smoke = requireEvidence(input.evidence, "Homepage smoke");
  const recheck = input.evidence.find(
    (item) => item.kind === "Recheck proposal",
  );

  const immutable = resolveImmutableEvidenceIds(input, source, ci);
  if (source && source.value !== input.candidateCommit) {
    return result(
      "EVIDENCE_INVALID",
      input.candidateCommit,
      immutable,
      deployment,
      smoke,
      recheck,
    );
  }
  if (ci && (ci.value !== "success" || ci.headSha !== input.candidateCommit)) {
    return result(
      "REQUIRED_CI_FAILED",
      input.candidateCommit,
      immutable,
      deployment,
      smoke,
      recheck,
    );
  }
  if (smoke.value !== "healthy") {
    throw invalid(
      "A deployment observation requires a healthy homepage smoke.",
    );
  }

  const deployed = deployment.value === input.candidateCommit;
  if (input.phase === "EXTENSION_OBSERVATION") {
    if (recheck)
      throw invalid("An extension cannot schedule a second recheck.");
    return result(
      deployed ? "EXTENSION_READY" : "EXTENSION_EXHAUSTED",
      input.candidateCommit,
      immutable,
      deployment,
      smoke,
    );
  }

  if (deployed && recheck) {
    throw invalid("A matching deployment cannot schedule a recheck.");
  }
  if (!deployed && !recheck) {
    throw invalid("An old deployment must include one policy recheck receipt.");
  }
  return result(
    deployed ? "CANDIDATE_READY" : "NORMAL_WAIT_REQUIRED",
    input.candidateCommit,
    immutable,
    deployment,
    smoke,
    recheck,
  );
}

function assertReceiptBindings(
  evidence: readonly ReleaseStewardEvidence[],
  receipts: readonly ReleaseStewardToolReceipt[],
): void {
  if (evidence.length !== receipts.length) {
    throw invalid("Every receipt must bind exactly one evidence record.");
  }
  const evidenceIds = new Set<string>();
  const toolNames = new Set<string>();
  for (let index = 0; index < receipts.length; index += 1) {
    const item = evidence[index];
    const receipt = receipts[index];
    if (!item || !receipt || item.evidenceId !== receipt.evidenceId) {
      throw invalid("Receipt and evidence order or IDs do not match.");
    }
    assertToolEvidenceBinding(item, receipt);
    if (evidenceIds.has(item.evidenceId) || toolNames.has(receipt.toolName)) {
      throw invalid("Duplicate evidence IDs or tool receipts are forbidden.");
    }
    if (receipt.externalMutations !== 0) {
      throw invalid("Observation receipts must prove zero external mutations.");
    }
    evidenceIds.add(item.evidenceId);
    toolNames.add(receipt.toolName);
  }
}

function assertToolEvidenceBinding(
  evidence: ReleaseStewardEvidence,
  receipt: ReleaseStewardToolReceipt,
): void {
  const expected = {
    [RELEASE_STEWARD_TOOL_NAMES.source]: {
      kind: "Source revision",
      provider: "github",
    },
    [RELEASE_STEWARD_TOOL_NAMES.ci]: {
      kind: "CI status",
      provider: "github",
    },
    [RELEASE_STEWARD_TOOL_NAMES.deployment]: {
      kind: "Deployed revision",
      provider: "deployment-marker",
    },
    [RELEASE_STEWARD_TOOL_NAMES.smoke]: {
      kind: "Homepage smoke",
      provider: "homepage",
    },
    [RELEASE_STEWARD_TOOL_NAMES.recheck]: {
      kind: "Recheck proposal",
      provider: "policy-clock",
    },
  } as const;
  const binding = expected[receipt.toolName as keyof typeof expected] as
    { readonly kind: string; readonly provider: string } | undefined;
  if (
    !binding ||
    evidence.kind !== binding.kind ||
    receipt.provider !== binding.provider ||
    evidence.status !== "Verified" ||
    receipt.providerRecordId === "" ||
    !Number.isFinite(Date.parse(receipt.fetchedAt))
  ) {
    throw invalid("A tool receipt is not bound to its expected evidence kind.");
  }

  if (
    (evidence.kind === "Source revision" ||
      evidence.kind === "Deployed revision") &&
    !FULL_COMMIT_PATTERN.test(evidence.value)
  ) {
    throw invalid(`${evidence.kind} must contain one full lowercase SHA.`);
  }
  if (
    evidence.kind === "CI status" &&
    (!evidence.headSha || !FULL_COMMIT_PATTERN.test(evidence.headSha))
  ) {
    throw invalid("CI evidence must bind one full lowercase head SHA.");
  }
  if (evidence.kind === "Homepage smoke" && evidence.value !== "healthy") {
    throw invalid("Homepage smoke evidence must be healthy.");
  }
  if (
    evidence.kind === "Recheck proposal" &&
    (!Number.isSafeInteger(evidence.durationMs) ||
      (evidence.durationMs ?? 0) <= 0 ||
      !Number.isFinite(Date.parse(evidence.value)))
  ) {
    throw invalid("Recheck evidence must contain a valid bounded wait.");
  }
}

function assertReceiptSequence(
  phase: ReleaseStewardObservationPhase,
  receipts: readonly ReleaseStewardToolReceipt[],
): void {
  const allowed = new Set(releaseStewardToolNamesForPhase(phase));
  const actual = receipts.map((receipt) => receipt.toolName);
  if (actual.some((name) => !allowed.has(name))) {
    throw invalid(`The ${phase} cycle contains a foreign tool receipt.`);
  }
  const requiredPrefix: readonly ReleaseStewardToolName[] =
    phase === "FIRST_OBSERVATION"
      ? [
          RELEASE_STEWARD_TOOL_NAMES.source,
          RELEASE_STEWARD_TOOL_NAMES.ci,
          RELEASE_STEWARD_TOOL_NAMES.deployment,
          RELEASE_STEWARD_TOOL_NAMES.smoke,
        ]
      : [
          RELEASE_STEWARD_TOOL_NAMES.deployment,
          RELEASE_STEWARD_TOOL_NAMES.smoke,
        ];
  if (
    actual.length < requiredPrefix.length ||
    requiredPrefix.some((name, index) => actual[index] !== name)
  ) {
    throw invalid(
      `The ${phase} cycle is incomplete or deployment was not immediately followed by homepage smoke.`,
    );
  }
  const tail = actual.slice(requiredPrefix.length);
  if (
    tail.length > 1 ||
    (tail.length === 1 && tail[0] !== RELEASE_STEWARD_TOOL_NAMES.recheck)
  ) {
    throw invalid(`The ${phase} receipt sequence is impossible.`);
  }
}

function resolveImmutableEvidenceIds(
  input: ReleaseStewardPostconditionInput,
  source: ReleaseStewardEvidence | undefined,
  ci: ReleaseStewardEvidence | undefined,
): { readonly source: string; readonly ci: string } {
  if (input.phase === "FIRST_OBSERVATION") {
    if (!source || !ci)
      throw invalid("First observation source or CI is missing.");
    return Object.freeze({ source: source.evidenceId, ci: ci.evidenceId });
  }
  if (!input.immutableEvidenceIds?.source || !input.immutableEvidenceIds.ci) {
    throw invalid(
      "Later observations must reference immutable source and CI IDs.",
    );
  }
  return Object.freeze({ ...input.immutableEvidenceIds });
}

function requireEvidence(
  evidence: readonly ReleaseStewardEvidence[],
  kind: ReleaseStewardEvidence["kind"],
): ReleaseStewardEvidence {
  const matches = evidence.filter((item) => item.kind === kind);
  if (matches.length !== 1 || !matches[0]) {
    throw invalid(`Exactly one ${kind} evidence record is required.`);
  }
  return matches[0];
}

function result(
  signal: ReleaseStewardPostcondition["signal"],
  candidateCommit: string,
  immutable: { readonly source: string; readonly ci: string },
  deployment: ReleaseStewardEvidence,
  smoke: ReleaseStewardEvidence,
  recheck?: ReleaseStewardEvidence,
): Readonly<ReleaseStewardPostcondition> {
  return Object.freeze({
    signal,
    candidateCommit,
    sourceEvidenceId: immutable.source,
    ciEvidenceId: immutable.ci,
    deploymentEvidenceId: deployment.evidenceId,
    homepageSmokeEvidenceId: smoke.evidenceId,
    ...(recheck ? { recheckEvidenceId: recheck.evidenceId } : {}),
    externalMutations: 0,
  });
}

function invalid(message: string): ReleaseStewardPostconditionError {
  return new ReleaseStewardPostconditionError(message);
}
