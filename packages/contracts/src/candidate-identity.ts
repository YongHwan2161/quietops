import {
  ContractValidationError,
  isRecord,
  type ValidationIssue,
} from "./validation.js";

export const CONTRACT_SCHEMA_VERSION = "1" as const;

export interface CandidateIdentity {
  readonly schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  readonly repository: string;
  readonly branch: string;
  readonly commit: string;
  readonly deploymentUrl: string;
}

const CANDIDATE_KEYS = Object.freeze([
  "schemaVersion",
  "repository",
  "branch",
  "commit",
  "deploymentUrl",
] as const);

const REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/;
const FULL_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function parseCandidateIdentity(value: unknown): CandidateIdentity {
  if (!isRecord(value)) {
    throw new ContractValidationError("Invalid candidate identity.", [
      {
        code: "invalid_type",
        message: "Expected an object.",
        path: "$",
      },
    ]);
  }

  const issues: ValidationIssue[] = [];

  for (const key of Object.keys(value)) {
    if (!(CANDIDATE_KEYS as readonly string[]).includes(key)) {
      issues.push({
        code: "unknown_key",
        message: "Unknown fields are not accepted.",
        path: `$.${key}`,
      });
    }
  }

  const schemaVersion = readString(value, "schemaVersion", issues);
  const repository = readString(value, "repository", issues);
  const branch = readString(value, "branch", issues);
  const commit = readString(value, "commit", issues);
  const deploymentUrl = readString(value, "deploymentUrl", issues);

  if (
    schemaVersion !== undefined &&
    schemaVersion !== CONTRACT_SCHEMA_VERSION
  ) {
    issues.push({
      code: "invalid_value",
      message: `Expected schema version ${CONTRACT_SCHEMA_VERSION}.`,
      path: "$.schemaVersion",
    });
  }

  if (repository !== undefined && !REPOSITORY_PATTERN.test(repository)) {
    issues.push({
      code: "invalid_format",
      message: "Expected a repository in owner/name form.",
      path: "$.repository",
    });
  }

  if (
    branch !== undefined &&
    (branch.length === 0 ||
      branch.length > 255 ||
      branch.trim() !== branch ||
      CONTROL_CHARACTER_PATTERN.test(branch))
  ) {
    issues.push({
      code: "invalid_format",
      message:
        "Expected a non-empty branch of at most 255 characters without surrounding whitespace or control characters.",
      path: "$.branch",
    });
  }

  if (commit !== undefined && !FULL_GIT_SHA_PATTERN.test(commit)) {
    issues.push({
      code: "invalid_format",
      message: "Expected a full 40-character Git commit SHA.",
      path: "$.commit",
    });
  }

  if (deploymentUrl !== undefined && !isAllowedDeploymentUrl(deploymentUrl)) {
    issues.push({
      code: "invalid_format",
      message:
        "Expected an absolute HTTP(S) URL without credentials or a fragment.",
      path: "$.deploymentUrl",
    });
  }

  if (issues.length > 0) {
    throw new ContractValidationError("Invalid candidate identity.", issues);
  }

  return Object.freeze({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    repository: repository!,
    branch: branch!,
    commit: commit!,
    deploymentUrl: deploymentUrl!,
  });
}

function readString(
  value: Record<string, unknown>,
  key: (typeof CANDIDATE_KEYS)[number],
  issues: ValidationIssue[],
): string | undefined {
  const field = value[key];

  if (typeof field !== "string") {
    issues.push({
      code: "invalid_type",
      message: "Expected a string.",
      path: `$.${key}`,
    });
    return undefined;
  }

  return field;
}

function isAllowedDeploymentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}
