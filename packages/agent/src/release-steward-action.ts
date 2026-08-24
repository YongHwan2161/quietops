import {
  type GitHubIncidentActionResult,
  type GitHubIncidentPlan,
} from "@quietops/adapters";
import { Agent, tool, type JSONValue, type Model } from "@strands-agents/sdk";
import { z } from "zod";

import { STRANDS_SDK_VERSION } from "./run-mismatch.js";
import { ReleaseStewardToolBudget } from "./release-steward-tool-budget.js";
import {
  RELEASE_STEWARD_TOOL_NAMES,
  createReleaseStewardRecorder,
  createReleaseStewardTools,
} from "./release-steward-tools.js";

const EMPTY_INPUT = z.object({}).strict();
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type GitHubIncidentExecutor = (
  plan: Readonly<GitHubIncidentPlan>,
) => Promise<GitHubIncidentActionResult>;

export interface RunReleaseStewardIncidentActionOptions {
  readonly plan: Readonly<GitHubIncidentPlan>;
  readonly executeIncident: GitHubIncidentExecutor;
  readonly model: Model;
  readonly modelMode: "bedrock-live" | "injected-test";
}

export interface ReleaseStewardIncidentActionResult {
  readonly agentRuntime: "@strands-agents/sdk";
  readonly agentRuntimeVersion: typeof STRANDS_SDK_VERSION;
  readonly modelMode: "bedrock-live" | "injected-test";
  readonly phase: "ESCALATION_RESUME";
  readonly modelNarration: string;
  readonly requestFingerprint: string;
  readonly action: GitHubIncidentActionResult;
  readonly toolCallCounts: Readonly<{
    create_github_incident: 1;
  }>;
  readonly externalWriteAttempts: 1;
}

export async function runReleaseStewardIncidentAction(
  options: Readonly<RunReleaseStewardIncidentActionOptions>,
): Promise<Readonly<ReleaseStewardIncidentActionResult>> {
  if (!options.model) {
    throw new Error(
      "Release steward incident model injection is required; no scripted fallback exists.",
    );
  }
  if (
    options.modelMode === "bedrock-live" &&
    options.model.getConfig().modelId ===
      "quietops-credential-free-scripted-model"
  ) {
    throw new Error(
      "Release steward bedrock-live mode refuses the preserved scripted demonstration model.",
    );
  }

  let action: GitHubIncidentActionResult | undefined;
  const incidentTool = tool<typeof EMPTY_INPUT, JSONValue>({
    name: RELEASE_STEWARD_TOOL_NAMES.incident,
    description:
      "Execute the already-authorized, construction-bound QuietOps GitHub incident plan exactly once.",
    inputSchema: EMPTY_INPUT,
    callback: async () => {
      if (action !== undefined) {
        throw new Error(
          "The authorized incident provider was already invoked.",
        );
      }
      action = validateActionResult(
        await options.executeIncident(options.plan),
      );
      return {
        status: action.status,
        providerRecordId: action.providerRecordId,
        providerUrl: action.providerUrl,
        responseDigest: action.responseDigest,
        requestFingerprint: options.plan.requestFingerprint,
        externalWriteAttempts: 1,
      };
    },
  });
  const budget = new ReleaseStewardToolBudget("ESCALATION_RESUME");
  const agent = new Agent({
    model: options.model,
    plugins: [budget],
    tools: [
      ...createReleaseStewardTools(
        "ESCALATION_RESUME",
        createReleaseStewardRecorder(),
        { incidentTool },
      ),
    ],
    toolExecutor: "sequential",
    printer: false,
    systemPrompt:
      "Call create_github_incident exactly once. The action is already authorized and immutable; do not request or invent arguments and do not retry.",
  });
  const agentResult = await agent.invoke(
    `Resume authorized QuietOps action ${options.plan.requestFingerprint}.`,
  );
  budget.assertNoViolations();
  if (
    action === undefined ||
    budget.callCounts()[RELEASE_STEWARD_TOOL_NAMES.incident] !== 1
  ) {
    throw new Error(
      "The authorized incident invocation did not execute exactly one tool call.",
    );
  }
  return Object.freeze({
    agentRuntime: "@strands-agents/sdk",
    agentRuntimeVersion: STRANDS_SDK_VERSION,
    modelMode: options.modelMode,
    phase: "ESCALATION_RESUME",
    modelNarration: agentResult.toString(),
    requestFingerprint: options.plan.requestFingerprint,
    action,
    toolCallCounts: Object.freeze({ create_github_incident: 1 as const }),
    externalWriteAttempts: 1 as const,
  });
}

function validateActionResult(
  value: Readonly<GitHubIncidentActionResult>,
): GitHubIncidentActionResult {
  if (
    value.externalWriteAttempts !== 1 ||
    !["CONFIRMED", "REJECTED", "UNCERTAIN"].includes(value.status) ||
    (value.responseDigest !== null &&
      !SHA256_PATTERN.test(value.responseDigest))
  ) {
    throw new Error("The incident provider returned an invalid result.");
  }
  if (value.status === "CONFIRMED") {
    if (
      !/^[1-9]\d{0,19}$/.test(value.providerRecordId) ||
      value.providerUrl !==
        `https://github.com/YongHwan2161/quietops/issues/${value.providerRecordId}` ||
      value.responseDigest === null
    ) {
      throw new Error("The confirmed incident receipt is invalid.");
    }
  } else if (value.providerRecordId !== null || value.providerUrl !== null) {
    throw new Error("A non-confirmed incident cannot claim provider identity.");
  }
  return Object.freeze({ ...value }) as GitHubIncidentActionResult;
}
