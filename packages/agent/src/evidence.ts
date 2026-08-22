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
  readonly provider?: "github";
  readonly providerRecordId?: string;
  readonly sourceUrl?: string;
  readonly fetchedAt?: string;
  readonly externalMutations: 0;
}

export interface EvidenceRecorder {
  readonly observations: EvidenceObservation[];
  readonly toolCalls: ToolCallReceipt[];
}

export type FixtureReleaseScenario = "ready" | "deployed-sha-mismatch";
export type ReleaseScenario = FixtureReleaseScenario | "live-github-source-ci";

export interface ReleaseFixture<
  Scenario extends FixtureReleaseScenario = FixtureReleaseScenario,
> {
  readonly scenario: Scenario;
  readonly expectedCommit: string;
  readonly sourceCommit: string;
  readonly ciStatus: "success";
  readonly deployedCommit: string;
}

const READY_COMMIT = "9854d5cc21840c15652fea3e032b1711a940d57a";

export const READY_FIXTURE: ReleaseFixture<"ready"> = Object.freeze({
  scenario: "ready",
  expectedCommit: READY_COMMIT,
  sourceCommit: READY_COMMIT,
  ciStatus: "success",
  deployedCommit: READY_COMMIT,
});

export const MISMATCH_FIXTURE: ReleaseFixture<"deployed-sha-mismatch"> =
  Object.freeze({
    scenario: "deployed-sha-mismatch",
    expectedCommit: READY_COMMIT,
    sourceCommit: READY_COMMIT,
    ciStatus: "success",
    deployedCommit: "311238afe40b1b7d7d28c58eca40ccbd18aae892",
  });
