import { isAbsolute, relative, resolve, sep } from "node:path";

import { normalizeGitHubIssueToken } from "@quietops/adapters";
import {
  POLICY_PROFILE_NAMES,
  type PolicyProfileName,
} from "@quietops/contracts";

import type { DecisionMode } from "./server.js";
import { normalizeOperatorToken } from "./operator-auth.js";

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface ResolveQuietOpsRuntimeConfigOptions {
  readonly repositoryRoot?: string;
}

export interface QuietOpsRuntimeConfig {
  readonly host: "127.0.0.1" | "0.0.0.0";
  readonly port: number;
  readonly decisionMode: DecisionMode;
  readonly databasePath: string;
  readonly releaseCommit?: string;
  readonly workerEnabled: boolean;
  readonly singleReplicaConfirmed: boolean;
  readonly policyProfile: PolicyProfileName;
  readonly githubWebhookEnabled: boolean;
  readonly githubWebhookSecret?: string;
  readonly operatorToken?: string;
  readonly githubIssueToken?: string;
  readonly githubIssueActionEnabled: boolean;
}

export function resolveQuietOpsRuntimeConfig(
  environment: RuntimeEnvironment = process.env,
  options: ResolveQuietOpsRuntimeConfigOptions = {},
): QuietOpsRuntimeConfig {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const host = parseHost(environment.QUIETOPS_HOST);
  const port = parsePorts(environment.PORT, environment.QUIETOPS_PORT);
  const decisionMode = parseDecisionMode(environment.QUIETOPS_DECISION_MODE);
  const releaseCommit = parseReleaseCommit(environment.QUIETOPS_RELEASE_COMMIT);
  const workerEnabled = parseBooleanFlag(
    environment.QUIETOPS_WORKER_ENABLED,
    "QUIETOPS_WORKER_ENABLED",
  );
  const singleReplicaConfirmed = parseBooleanFlag(
    environment.QUIETOPS_SINGLE_REPLICA_CONFIRMED,
    "QUIETOPS_SINGLE_REPLICA_CONFIRMED",
  );
  const policyProfile = parsePolicyProfile(
    environment.QUIETOPS_POLICY_PROFILE,
    workerEnabled,
  );
  const githubWebhookEnabled = parseBooleanFlag(
    environment.QUIETOPS_GITHUB_WEBHOOK_ENABLED,
    "QUIETOPS_GITHUB_WEBHOOK_ENABLED",
  );
  const githubWebhookSecret = parseWebhookSecret(
    environment.QUIETOPS_GITHUB_WEBHOOK_SECRET,
    githubWebhookEnabled,
  );
  const operatorToken =
    environment.QUIETOPS_OPERATOR_TOKEN !== undefined
      ? normalizeOperatorToken(environment.QUIETOPS_OPERATOR_TOKEN)
      : undefined;
  const githubIssueToken =
    environment.QUIETOPS_GITHUB_ISSUE_TOKEN !== undefined
      ? normalizeGitHubIssueToken(environment.QUIETOPS_GITHUB_ISSUE_TOKEN)
      : undefined;
  const githubIssueActionEnabled = parseBooleanFlag(
    environment.QUIETOPS_GITHUB_ISSUE_ACTION_ENABLED,
    "QUIETOPS_GITHUB_ISSUE_ACTION_ENABLED",
  );
  const databasePath = parseDatabasePath(
    environment.QUIETOPS_DB_PATH,
    repositoryRoot,
    host,
  );

  if (host === "0.0.0.0" && decisionMode !== "public-read-only") {
    throw new Error(
      "QUIETOPS_HOST=0.0.0.0 requires QUIETOPS_DECISION_MODE=public-read-only.",
    );
  }
  if (host === "0.0.0.0" && releaseCommit === undefined) {
    throw new Error(
      "QUIETOPS_HOST=0.0.0.0 requires a full QUIETOPS_RELEASE_COMMIT.",
    );
  }
  if (workerEnabled) {
    if (
      host !== "0.0.0.0" ||
      decisionMode !== "public-read-only" ||
      releaseCommit === undefined
    ) {
      throw new Error(
        "QUIETOPS_WORKER_ENABLED=true requires the fixed public read-only runtime and release commit.",
      );
    }
    if (!githubWebhookEnabled || !githubWebhookSecret) {
      throw new Error(
        "QUIETOPS_WORKER_ENABLED=true requires enabled signed GitHub webhook intake.",
      );
    }
    if (!operatorToken) {
      throw new Error(
        "QUIETOPS_WORKER_ENABLED=true requires QUIETOPS_OPERATOR_TOKEN.",
      );
    }
    if (!githubIssueToken) {
      throw new Error(
        "QUIETOPS_WORKER_ENABLED=true requires QUIETOPS_GITHUB_ISSUE_TOKEN to be installed even while issue action remains disabled.",
      );
    }
    if (!singleReplicaConfirmed) {
      throw new Error(
        "QUIETOPS_WORKER_ENABLED=true requires QUIETOPS_SINGLE_REPLICA_CONFIRMED=true after external topology verification.",
      );
    }
  }
  if (githubIssueActionEnabled && !workerEnabled) {
    throw new Error(
      "QUIETOPS_GITHUB_ISSUE_ACTION_ENABLED=true requires QUIETOPS_WORKER_ENABLED=true.",
    );
  }

  return Object.freeze({
    host,
    port,
    decisionMode,
    databasePath,
    workerEnabled,
    singleReplicaConfirmed,
    policyProfile,
    githubWebhookEnabled,
    githubIssueActionEnabled,
    ...(releaseCommit ? { releaseCommit } : {}),
    ...(githubWebhookSecret ? { githubWebhookSecret } : {}),
    ...(operatorToken ? { operatorToken } : {}),
    ...(githubIssueToken ? { githubIssueToken } : {}),
  });
}

function parsePolicyProfile(
  value: string | undefined,
  workerEnabled: boolean,
): PolicyProfileName {
  if (value === undefined) {
    if (workerEnabled) {
      throw new Error(
        `QUIETOPS_WORKER_ENABLED=true requires QUIETOPS_POLICY_PROFILE=${POLICY_PROFILE_NAMES.join("|")}.`,
      );
    }
    return "standard-v1";
  }
  if ((POLICY_PROFILE_NAMES as readonly string[]).includes(value)) {
    return value as PolicyProfileName;
  }
  throw new Error(
    `QUIETOPS_POLICY_PROFILE must be ${POLICY_PROFILE_NAMES.join(" or ")}.`,
  );
}

function parseBooleanFlag(value: string | undefined, name: string): boolean {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error(`${name} must be true or false.`);
}

function parseWebhookSecret(
  value: string | undefined,
  enabled: boolean,
): string | undefined {
  if (!enabled) return undefined;
  if (
    value === undefined ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    Buffer.byteLength(value, "utf8") < 32 ||
    Buffer.byteLength(value, "utf8") > 256
  ) {
    throw new Error(
      "Enabled GitHub webhook intake requires a 32-256 byte QUIETOPS_GITHUB_WEBHOOK_SECRET without surrounding whitespace or control characters.",
    );
  }
  return value;
}

function parseHost(value: string | undefined): QuietOpsRuntimeConfig["host"] {
  if (value === undefined || value === "127.0.0.1") return "127.0.0.1";
  if (value === "0.0.0.0") return value;
  throw new Error("QUIETOPS_HOST must be 127.0.0.1 or 0.0.0.0.");
}

function parsePorts(
  platformValue: string | undefined,
  quietOpsValue: string | undefined,
): number {
  const platformPort = parseOptionalPort(platformValue, "PORT");
  const quietOpsPort = parseOptionalPort(quietOpsValue, "QUIETOPS_PORT");
  if (
    platformPort !== undefined &&
    quietOpsPort !== undefined &&
    platformPort !== quietOpsPort
  ) {
    throw new Error("PORT and QUIETOPS_PORT must match when both are set.");
  }
  return platformPort ?? quietOpsPort ?? 4173;
}

function parseOptionalPort(
  value: string | undefined,
  name: "PORT" | "QUIETOPS_PORT",
): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer from 1 through 65535.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be an integer from 1 through 65535.`);
  }
  return parsed;
}

function parseDecisionMode(value: string | undefined): DecisionMode {
  if (value === undefined || value === "local-interactive") {
    return "local-interactive";
  }
  if (value === "public-read-only") return value;
  throw new Error(
    "QUIETOPS_DECISION_MODE must be local-interactive or public-read-only.",
  );
}

function parseReleaseCommit(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(
      "QUIETOPS_RELEASE_COMMIT must be 40 lowercase hexadecimal characters.",
    );
  }
  return value;
}

function parseDatabasePath(
  value: string | undefined,
  repositoryRoot: string,
  host: QuietOpsRuntimeConfig["host"],
): string {
  if (value !== undefined && (value.length === 0 || value.includes("\0"))) {
    throw new Error("QUIETOPS_DB_PATH must be a non-empty filesystem path.");
  }

  if (host === "0.0.0.0" && (value === undefined || !isAbsolute(value))) {
    throw new Error(
      "QUIETOPS_HOST=0.0.0.0 requires an absolute QUIETOPS_DB_PATH.",
    );
  }

  const databasePath = resolve(
    repositoryRoot,
    value ?? ".quietops/quietops.sqlite",
  );
  if (host === "0.0.0.0" && isWithin(repositoryRoot, databasePath)) {
    throw new Error(
      "Public QUIETOPS_DB_PATH must be outside the application repository.",
    );
  }
  return databasePath;
}

function isWithin(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
}
