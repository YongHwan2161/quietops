export const EVIDENCE_KINDS = Object.freeze([
  "Source revision",
  "CI status",
  "Deployed revision",
] as const);

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface EvidenceObservation {
  readonly evidenceId: string;
  readonly kind: EvidenceKind;
  readonly status: "Verified";
  readonly value: string;
}

export interface ToolCallReceipt {
  readonly toolName: string;
  readonly evidenceId: string;
  readonly externalMutations: 0;
}

export interface EvidenceRecorder {
  readonly observations: EvidenceObservation[];
  readonly toolCalls: ToolCallReceipt[];
}

export interface MismatchFixture {
  readonly expectedCommit: string;
  readonly sourceCommit: string;
  readonly ciStatus: "success";
  readonly deployedCommit: string;
}

export const MISMATCH_FIXTURE: MismatchFixture = Object.freeze({
  expectedCommit: "9854d5cc21840c15652fea3e032b1711a940d57a",
  sourceCommit: "9854d5cc21840c15652fea3e032b1711a940d57a",
  ciStatus: "success",
  deployedCommit: "311238afe40b1b7d7d28c58eca40ccbd18aae892",
});
