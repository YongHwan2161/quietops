import {
  QUIETOPS_GITHUB_TARGET,
  collectGitHubSourceAndCiEvidence,
  createDeploymentRevisionCollector,
  createHomepageSmokeCollector,
  type DeploymentEvidenceBundle,
  type GitHubEvidenceBundle,
  type HomepageSmokeBundle,
} from "@quietops/adapters";
import { tool, type InvokableTool, type JSONValue } from "@strands-agents/sdk";
import { z } from "zod";

import { QUIETOPS_LIVE_DEPLOYMENT_TARGET } from "./live-release-tools.js";

const EMPTY_INPUT = z.object({}).strict();

export const QUIETOPS_LIVE_HOMEPAGE_TARGET = Object.freeze({
  repository: QUIETOPS_GITHUB_TARGET.repository,
  homepageUrl: "https://quietops-production.up.railway.app/",
} as const);

export const RELEASE_STEWARD_TOOL_NAMES = Object.freeze({
  source: "observe_source_revision",
  ci: "observe_required_ci",
  deployment: "observe_deployment_revision",
  smoke: "observe_homepage_smoke",
  recheck: "schedule_recheck",
  incident: "create_github_incident",
} as const);

export type ReleaseStewardToolName =
  (typeof RELEASE_STEWARD_TOOL_NAMES)[keyof typeof RELEASE_STEWARD_TOOL_NAMES];

export const RELEASE_STEWARD_PHASES = Object.freeze([
  "FIRST_OBSERVATION",
  "LATER_OBSERVATION",
  "EXTENSION_OBSERVATION",
  "ESCALATION_RESUME",
] as const);

export type ReleaseStewardPhase = (typeof RELEASE_STEWARD_PHASES)[number];
export type ReleaseStewardObservationPhase = Exclude<
  ReleaseStewardPhase,
  "ESCALATION_RESUME"
>;

const PHASE_TOOL_NAMES = Object.freeze({
  FIRST_OBSERVATION: Object.freeze([
    RELEASE_STEWARD_TOOL_NAMES.source,
    RELEASE_STEWARD_TOOL_NAMES.ci,
    RELEASE_STEWARD_TOOL_NAMES.deployment,
    RELEASE_STEWARD_TOOL_NAMES.smoke,
    RELEASE_STEWARD_TOOL_NAMES.recheck,
  ] as const),
  LATER_OBSERVATION: Object.freeze([
    RELEASE_STEWARD_TOOL_NAMES.deployment,
    RELEASE_STEWARD_TOOL_NAMES.smoke,
    RELEASE_STEWARD_TOOL_NAMES.recheck,
  ] as const),
  EXTENSION_OBSERVATION: Object.freeze([
    RELEASE_STEWARD_TOOL_NAMES.deployment,
    RELEASE_STEWARD_TOOL_NAMES.smoke,
  ] as const),
  ESCALATION_RESUME: Object.freeze([
    RELEASE_STEWARD_TOOL_NAMES.incident,
  ] as const),
} satisfies Record<ReleaseStewardPhase, readonly ReleaseStewardToolName[]>);

export type ReleaseStewardEvidenceKind =
  | "Source revision"
  | "CI status"
  | "Deployed revision"
  | "Homepage smoke"
  | "Recheck proposal";

export interface ReleaseStewardEvidence {
  readonly evidenceId: string;
  readonly kind: ReleaseStewardEvidenceKind;
  readonly status: "Verified";
  readonly value: string;
  readonly headSha?: string;
  readonly durationMs?: number;
}

export interface ReleaseStewardToolReceipt {
  readonly toolName: ReleaseStewardToolName;
  readonly evidenceId: string;
  readonly provider:
    "github" | "deployment-marker" | "homepage" | "policy-clock";
  readonly providerRecordId: string;
  readonly sourceUrl?: string;
  readonly fetchedAt: string;
  readonly externalMutations: 0;
}

export interface ReleaseStewardRecorder {
  readonly evidence: ReleaseStewardEvidence[];
  readonly receipts: ReleaseStewardToolReceipt[];
}

export interface RecheckProposal {
  readonly waitUntil: string;
  readonly durationMs: number;
  readonly policyProfile: string;
}

export interface CreateReleaseStewardToolsOptions {
  readonly githubCollector?: () => Promise<GitHubEvidenceBundle>;
  readonly deploymentCollector?: () => Promise<DeploymentEvidenceBundle>;
  readonly homepageCollector?: () => Promise<HomepageSmokeBundle>;
  readonly recheckProposal?: Readonly<RecheckProposal>;
  readonly incidentTool?: InvokableTool<Record<string, never>, JSONValue>;
}

export function createReleaseStewardRecorder(): ReleaseStewardRecorder {
  return { evidence: [], receipts: [] };
}

export function releaseStewardToolNamesForPhase(
  phase: ReleaseStewardPhase,
): readonly ReleaseStewardToolName[] {
  return PHASE_TOOL_NAMES[phase];
}

export function createReleaseStewardTools(
  phase: ReleaseStewardPhase,
  recorder: ReleaseStewardRecorder,
  options: CreateReleaseStewardToolsOptions = {},
): readonly InvokableTool<Record<string, never>, JSONValue>[] {
  if (phase === "ESCALATION_RESUME") {
    if (!options.incidentTool) {
      throw new Error(
        "ESCALATION_RESUME requires one separately authorized incident tool.",
      );
    }
    if (options.incidentTool.name !== RELEASE_STEWARD_TOOL_NAMES.incident) {
      throw new Error(
        `The incident tool must be named ${RELEASE_STEWARD_TOOL_NAMES.incident}.`,
      );
    }
    return Object.freeze([options.incidentTool]);
  }

  if (
    phase !== "EXTENSION_OBSERVATION" &&
    options.recheckProposal === undefined
  ) {
    throw new Error(`${phase} requires a policy-clamped recheck proposal.`);
  }

  const githubCollector =
    options.githubCollector ??
    (() => collectGitHubSourceAndCiEvidence(QUIETOPS_GITHUB_TARGET));
  const deploymentCollector =
    options.deploymentCollector ??
    createDeploymentRevisionCollector(QUIETOPS_LIVE_DEPLOYMENT_TARGET);
  const homepageCollector =
    options.homepageCollector ??
    createHomepageSmokeCollector(QUIETOPS_LIVE_HOMEPAGE_TARGET);
  let sharedGitHubCollection: Promise<GitHubEvidenceBundle> | undefined;
  const collectGitHubOnce = (): Promise<GitHubEvidenceBundle> => {
    sharedGitHubCollection ??= githubCollector();
    return sharedGitHubCollection;
  };

  const toolsByName = new Map<
    ReleaseStewardToolName,
    InvokableTool<Record<string, never>, JSONValue>
  >([
    [
      RELEASE_STEWARD_TOOL_NAMES.source,
      emptyInputTool(
        RELEASE_STEWARD_TOOL_NAMES.source,
        "Read the fixed public GitHub source revision.",
        async () => {
          const bundle = await collectGitHubOnce();
          return record(
            recorder,
            {
              evidenceId: bundle.source.evidenceId,
              kind: bundle.source.kind,
              status: bundle.source.status,
              value: bundle.source.value,
            },
            {
              toolName: RELEASE_STEWARD_TOOL_NAMES.source,
              evidenceId: bundle.source.evidenceId,
              provider: "github",
              providerRecordId: bundle.source.value,
              sourceUrl: bundle.source.sourceUrl,
              fetchedAt: bundle.source.fetchedAt,
              externalMutations: 0,
            },
          );
        },
      ),
    ],
    [
      RELEASE_STEWARD_TOOL_NAMES.ci,
      emptyInputTool(
        RELEASE_STEWARD_TOOL_NAMES.ci,
        "Read the completed required CI result bound to the fixed source revision.",
        async () => {
          const bundle = await collectGitHubOnce();
          return record(
            recorder,
            {
              evidenceId: bundle.ci.evidenceId,
              kind: bundle.ci.kind,
              status: bundle.ci.status,
              value: bundle.ci.value,
              headSha: bundle.ci.headSha,
            },
            {
              toolName: RELEASE_STEWARD_TOOL_NAMES.ci,
              evidenceId: bundle.ci.evidenceId,
              provider: "github",
              providerRecordId: String(bundle.ci.runId),
              sourceUrl: bundle.ci.sourceUrl,
              fetchedAt: bundle.ci.fetchedAt,
              externalMutations: 0,
            },
          );
        },
      ),
    ],
    [
      RELEASE_STEWARD_TOOL_NAMES.deployment,
      emptyInputTool(
        RELEASE_STEWARD_TOOL_NAMES.deployment,
        "Read the fixed deployment revision marker.",
        async () => {
          const bundle = await deploymentCollector();
          return record(
            recorder,
            {
              evidenceId: bundle.deployment.evidenceId,
              kind: bundle.deployment.kind,
              status: bundle.deployment.status,
              value: bundle.deployment.value,
            },
            {
              toolName: RELEASE_STEWARD_TOOL_NAMES.deployment,
              evidenceId: bundle.deployment.evidenceId,
              provider: "deployment-marker",
              providerRecordId: bundle.deployment.value,
              sourceUrl: bundle.deployment.sourceUrl,
              fetchedAt: bundle.deployment.fetchedAt,
              externalMutations: 0,
            },
          );
        },
      ),
    ],
    [
      RELEASE_STEWARD_TOOL_NAMES.smoke,
      emptyInputTool(
        RELEASE_STEWARD_TOOL_NAMES.smoke,
        "Check the fixed homepage for HTTP 200 HTML and the stable product marker.",
        async () => {
          const bundle = await homepageCollector();
          return record(
            recorder,
            {
              evidenceId: bundle.smoke.evidenceId,
              kind: bundle.smoke.kind,
              status: bundle.smoke.status,
              value: bundle.smoke.value,
            },
            {
              toolName: RELEASE_STEWARD_TOOL_NAMES.smoke,
              evidenceId: bundle.smoke.evidenceId,
              provider: "homepage",
              providerRecordId: String(bundle.smoke.httpStatus),
              sourceUrl: bundle.smoke.sourceUrl,
              fetchedAt: bundle.smoke.fetchedAt,
              externalMutations: 0,
            },
          );
        },
      ),
    ],
    [
      RELEASE_STEWARD_TOOL_NAMES.recheck,
      emptyInputTool(
        RELEASE_STEWARD_TOOL_NAMES.recheck,
        "Return the construction-bound, policy-clamped recheck time.",
        async () => {
          const proposal = requireValidRecheckProposal(options.recheckProposal);
          const evidenceId = `recheck:${proposal.waitUntil}`;
          return record(
            recorder,
            {
              evidenceId,
              kind: "Recheck proposal",
              status: "Verified",
              value: proposal.waitUntil,
              durationMs: proposal.durationMs,
            },
            {
              toolName: RELEASE_STEWARD_TOOL_NAMES.recheck,
              evidenceId,
              provider: "policy-clock",
              providerRecordId: proposal.policyProfile,
              fetchedAt: new Date(
                Date.parse(proposal.waitUntil) - proposal.durationMs,
              ).toISOString(),
              externalMutations: 0,
            },
          );
        },
      ),
    ],
  ]);

  return Object.freeze(
    releaseStewardToolNamesForPhase(phase).map((name) => {
      const selected = toolsByName.get(name);
      if (!selected) throw new Error(`No implementation exists for ${name}.`);
      return selected;
    }),
  );
}

function emptyInputTool(
  name: ReleaseStewardToolName,
  description: string,
  callback: () => Promise<JSONValue>,
): InvokableTool<Record<string, never>, JSONValue> {
  return tool<typeof EMPTY_INPUT, JSONValue>({
    name,
    description,
    inputSchema: EMPTY_INPUT,
    callback,
  });
}

function record(
  recorder: ReleaseStewardRecorder,
  evidence: ReleaseStewardEvidence,
  receipt: ReleaseStewardToolReceipt,
): JSONValue {
  if (evidence.evidenceId !== receipt.evidenceId) {
    throw new Error("Evidence and receipt IDs must match.");
  }
  const frozenEvidence = Object.freeze({ ...evidence });
  const frozenReceipt = Object.freeze({ ...receipt });
  recorder.evidence.push(frozenEvidence);
  recorder.receipts.push(frozenReceipt);
  return {
    evidenceId: frozenEvidence.evidenceId,
    kind: frozenEvidence.kind,
    status: frozenEvidence.status,
    value: frozenEvidence.value,
    ...(frozenEvidence.headSha ? { headSha: frozenEvidence.headSha } : {}),
    ...(frozenEvidence.durationMs !== undefined
      ? { durationMs: frozenEvidence.durationMs }
      : {}),
    provider: frozenReceipt.provider,
    providerRecordId: frozenReceipt.providerRecordId,
    sourceUrl: frozenReceipt.sourceUrl ?? "",
    fetchedAt: frozenReceipt.fetchedAt,
    externalMutations: frozenReceipt.externalMutations,
  };
}

function requireValidRecheckProposal(
  proposal: Readonly<RecheckProposal> | undefined,
): Readonly<RecheckProposal> {
  if (
    !proposal ||
    !Number.isSafeInteger(proposal.durationMs) ||
    proposal.durationMs <= 0 ||
    proposal.policyProfile.trim() === "" ||
    !Number.isFinite(Date.parse(proposal.waitUntil))
  ) {
    throw new Error("The recheck proposal is not policy-clamped and valid.");
  }
  return proposal;
}
