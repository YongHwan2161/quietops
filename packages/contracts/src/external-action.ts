import {
  finishContract,
  readInteger,
  readString,
  readUtcTimestamp,
  rejectUnknownKeys,
  requireRecord,
} from "./contract-fields.js";
import { parseVocabularyValue, type ValidationIssue } from "./validation.js";

export const EXTERNAL_ACTION_TYPES = Object.freeze([
  "CREATE_GITHUB_INCIDENT",
] as const);
export type ExternalActionType = (typeof EXTERNAL_ACTION_TYPES)[number];

export const EXTERNAL_ACTION_STATUSES = Object.freeze([
  "RESERVED",
  "IN_FLIGHT",
  "CONFIRMED",
  "REJECTED",
  "UNCERTAIN",
] as const);
export type ExternalActionStatus = (typeof EXTERNAL_ACTION_STATUSES)[number];

export interface ExternalActionProjection {
  readonly actionId: string;
  readonly runId: string;
  readonly actionType: ExternalActionType;
  readonly repository: "YongHwan2161/quietops";
  readonly requestFingerprint: string;
  readonly status: ExternalActionStatus;
  readonly attemptCount: 0 | 1;
  readonly providerRecordId: string | null;
  readonly providerUrl: string | null;
  readonly responseDigest: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const ACTION_KEYS = Object.freeze([
  "actionId",
  "runId",
  "actionType",
  "repository",
  "requestFingerprint",
  "status",
  "attemptCount",
  "providerRecordId",
  "providerUrl",
  "responseDigest",
  "createdAt",
  "updatedAt",
] as const);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function parseExternalActionType(value: unknown): ExternalActionType {
  return parseVocabularyValue(
    value,
    EXTERNAL_ACTION_TYPES,
    "external action type",
  );
}

export function parseExternalActionStatus(
  value: unknown,
): ExternalActionStatus {
  return parseVocabularyValue(
    value,
    EXTERNAL_ACTION_STATUSES,
    "external action status",
  );
}

export function parseExternalActionProjection(
  value: unknown,
): ExternalActionProjection {
  const record = requireRecord(value, "external action projection");
  const issues: ValidationIssue[] = [];
  rejectUnknownKeys(record, ACTION_KEYS, issues);

  const actionId = readString(record, "actionId", issues, {
    minLength: 1,
    maxLength: 128,
    pattern: IDENTIFIER_PATTERN,
  });
  const runId = readString(record, "runId", issues, {
    minLength: 1,
    maxLength: 128,
    pattern: IDENTIFIER_PATTERN,
  });
  const actionType = parseNestedVocabulary(
    record.actionType,
    EXTERNAL_ACTION_TYPES,
    "$.actionType",
    issues,
  );
  const repository = readString(record, "repository", issues);
  const requestFingerprint = readString(record, "requestFingerprint", issues, {
    minLength: 64,
    maxLength: 64,
    pattern: SHA256_PATTERN,
  });
  const status = parseNestedVocabulary(
    record.status,
    EXTERNAL_ACTION_STATUSES,
    "$.status",
    issues,
  );
  const attemptCount = readInteger(record, "attemptCount", issues, {
    minimum: 0,
    maximum: 1,
  });
  const providerRecordId = readNullableProviderRecordId(record, issues);
  const providerUrl = readNullableProviderUrl(record, issues);
  const responseDigest = readNullableDigest(record, issues);
  const createdAt = readUtcTimestamp(record, "createdAt", issues);
  const updatedAt = readUtcTimestamp(record, "updatedAt", issues);

  if (repository !== undefined && repository !== "YongHwan2161/quietops") {
    issues.push({
      code: "invalid_value",
      message: "Repository must match the construction-bound P0 target.",
      path: "$.repository",
    });
  }
  if (
    createdAt !== undefined &&
    updatedAt !== undefined &&
    updatedAt < createdAt
  ) {
    issues.push({
      code: "invalid_value",
      message: "Update time cannot precede creation time.",
      path: "$.updatedAt",
    });
  }

  const hasProviderIdentity =
    providerRecordId !== null &&
    providerRecordId !== undefined &&
    providerUrl !== null &&
    providerUrl !== undefined;
  const hasNoProviderIdentity =
    providerRecordId === null && providerUrl === null;
  if (
    (status === "CONFIRMED" &&
      (!hasProviderIdentity ||
        responseDigest === null ||
        responseDigest === undefined)) ||
    (status !== undefined &&
      status !== "CONFIRMED" &&
      !hasNoProviderIdentity) ||
    ((status === "RESERVED" || status === "IN_FLIGHT") &&
      responseDigest !== null)
  ) {
    issues.push({
      code: "invalid_value",
      message:
        "Provider receipt fields are required only for confirmed actions.",
      path: "$.status",
    });
  }
  if (
    providerRecordId !== null &&
    providerRecordId !== undefined &&
    providerUrl !== null &&
    providerUrl !== undefined
  ) {
    const expectedUrl = `https://github.com/YongHwan2161/quietops/issues/${providerRecordId}`;
    if (providerUrl !== expectedUrl) {
      issues.push({
        code: "invalid_value",
        message:
          "Provider URL must bind the fixed repository and issue number.",
        path: "$.providerUrl",
      });
    }
  }
  if (
    status === "RESERVED" &&
    attemptCount !== undefined &&
    attemptCount !== 0
  ) {
    issues.push({
      code: "invalid_value",
      message: "Reserved actions have not attempted provider access.",
      path: "$.attemptCount",
    });
  }
  if (
    status !== undefined &&
    status !== "RESERVED" &&
    attemptCount !== undefined &&
    attemptCount !== 1
  ) {
    issues.push({
      code: "invalid_value",
      message: "Started and terminal actions have exactly one attempt.",
      path: "$.attemptCount",
    });
  }

  return finishContract("external action projection", issues, {
    actionId: actionId!,
    runId: runId!,
    actionType: actionType!,
    repository: repository! as "YongHwan2161/quietops",
    requestFingerprint: requestFingerprint!,
    status: status!,
    attemptCount: attemptCount! as 0 | 1,
    providerRecordId: providerRecordId!,
    providerUrl: providerUrl!,
    responseDigest: responseDigest!,
    createdAt: createdAt!,
    updatedAt: updatedAt!,
  });
}

function parseNestedVocabulary<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string,
  issues: ValidationIssue[],
): Values[number] | undefined {
  if (typeof value !== "string" || !values.includes(value)) {
    issues.push({
      code: typeof value === "string" ? "invalid_value" : "invalid_type",
      message: `Expected one of: ${values.join(", ")}.`,
      path,
    });
    return undefined;
  }
  return value as Values[number];
}

function readNullableProviderRecordId(
  record: Record<string, unknown>,
  issues: ValidationIssue[],
): string | null | undefined {
  if (record.providerRecordId === null) {
    return null;
  }
  return readString(record, "providerRecordId", issues, {
    minLength: 1,
    maxLength: 20,
    pattern: /^[1-9]\d{0,19}$/,
  });
}

function readNullableProviderUrl(
  record: Record<string, unknown>,
  issues: ValidationIssue[],
): string | null | undefined {
  if (record.providerUrl === null) {
    return null;
  }
  const raw = readString(record, "providerUrl", issues, {
    minLength: 1,
    maxLength: 2_048,
  });
  if (raw === undefined) {
    return undefined;
  }
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      url.search !== ""
    ) {
      throw new Error("not allowed");
    }
  } catch {
    issues.push({
      code: "invalid_format",
      message: "Expected a credential-free GitHub HTTPS URL.",
      path: "$.providerUrl",
    });
    return undefined;
  }
  return raw;
}

function readNullableDigest(
  record: Record<string, unknown>,
  issues: ValidationIssue[],
): string | null | undefined {
  if (record.responseDigest === null) {
    return null;
  }
  return readString(record, "responseDigest", issues, {
    minLength: 64,
    maxLength: 64,
    pattern: SHA256_PATTERN,
  });
}
