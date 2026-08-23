import {
  finishContract,
  readBoolean,
  readInteger,
  readString,
  rejectUnknownKeys,
  requireRecord,
} from "./contract-fields.js";
import { parseVocabularyValue, type ValidationIssue } from "./validation.js";

export const RELEASE_RUN_STATES = Object.freeze([
  "MONITORING",
  "WAITING",
  "AWAITING_DECISION",
  "RESUMING",
  "COMPLETED",
  "ESCALATED",
  "STOPPED",
] as const);
export type ReleaseRunState = (typeof RELEASE_RUN_STATES)[number];

export const TERMINAL_RELEASE_RUN_STATES = Object.freeze([
  "COMPLETED",
  "ESCALATED",
  "STOPPED",
] as const satisfies readonly ReleaseRunState[]);

export const RELEASE_RUN_STOP_CODES = Object.freeze([
  "REQUIRED_CI_FAILED",
  "EVIDENCE_INVALID",
  "EVIDENCE_UNAVAILABLE",
  "DEPLOYMENT_UNHEALTHY",
  "HOMEPAGE_SMOKE_UNHEALTHY",
  "DECISION_EXPIRED",
  "EXTENSION_EXHAUSTED",
  "ACTION_REJECTED",
  "ACTION_OUTCOME_UNCERTAIN",
  "SUPERSEDED",
] as const);
export type ReleaseRunStopCode = (typeof RELEASE_RUN_STOP_CODES)[number];

export interface ReleaseRunPublicProjection {
  readonly runId: string;
  readonly state: ReleaseRunState;
  readonly candidateCommit: string;
  readonly attentionRequired: boolean;
  readonly observationCount: number;
  readonly waitCount: number;
  readonly humanPromptCount: 0 | 1;
  readonly externalWriteAttemptCount: 0 | 1;
  readonly stopCode: ReleaseRunStopCode | null;
}

const PROJECTION_KEYS = Object.freeze([
  "runId",
  "state",
  "candidateCommit",
  "attentionRequired",
  "observationCount",
  "waitCount",
  "humanPromptCount",
  "externalWriteAttemptCount",
  "stopCode",
] as const);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export function parseReleaseRunState(value: unknown): ReleaseRunState {
  return parseVocabularyValue(value, RELEASE_RUN_STATES, "release run state");
}

export function parseReleaseRunStopCode(value: unknown): ReleaseRunStopCode {
  return parseVocabularyValue(
    value,
    RELEASE_RUN_STOP_CODES,
    "release run stop code",
  );
}

export function isTerminalReleaseRunState(
  value: unknown,
): value is (typeof TERMINAL_RELEASE_RUN_STATES)[number] {
  return (
    typeof value === "string" &&
    (TERMINAL_RELEASE_RUN_STATES as readonly string[]).includes(value)
  );
}

export function parseReleaseRunPublicProjection(
  value: unknown,
): ReleaseRunPublicProjection {
  const record = requireRecord(value, "release run public projection");
  const issues: ValidationIssue[] = [];
  rejectUnknownKeys(record, PROJECTION_KEYS, issues);

  const runId = readString(record, "runId", issues, {
    minLength: 1,
    maxLength: 128,
    pattern: IDENTIFIER_PATTERN,
  });
  const state = parseNestedVocabulary(
    record.state,
    RELEASE_RUN_STATES,
    "$.state",
    issues,
  );
  const candidateCommit = readString(record, "candidateCommit", issues, {
    minLength: 40,
    maxLength: 40,
    pattern: COMMIT_PATTERN,
  });
  const attentionRequired = readBoolean(record, "attentionRequired", issues);
  const observationCount = readInteger(record, "observationCount", issues, {
    minimum: 0,
  });
  const waitCount = readInteger(record, "waitCount", issues, { minimum: 0 });
  const humanPromptCount = readInteger(record, "humanPromptCount", issues, {
    minimum: 0,
    maximum: 1,
  });
  const externalWriteAttemptCount = readInteger(
    record,
    "externalWriteAttemptCount",
    issues,
    { minimum: 0, maximum: 1 },
  );
  const stopCode = parseNullableStopCode(record.stopCode, issues);

  if (
    state !== undefined &&
    attentionRequired !== undefined &&
    attentionRequired !== (state === "AWAITING_DECISION")
  ) {
    issues.push({
      code: "invalid_value",
      message: "Attention is required only while awaiting a decision.",
      path: "$.attentionRequired",
    });
  }
  if (state !== undefined && (state === "STOPPED") !== (stopCode !== null)) {
    issues.push({
      code: "invalid_value",
      message: "A stop code is required only for STOPPED runs.",
      path: "$.stopCode",
    });
  }
  if (
    state === "AWAITING_DECISION" &&
    humanPromptCount !== undefined &&
    humanPromptCount !== 1
  ) {
    issues.push({
      code: "invalid_value",
      message: "Awaiting-decision projections contain exactly one prompt.",
      path: "$.humanPromptCount",
    });
  }

  return finishContract("release run public projection", issues, {
    runId: runId!,
    state: state!,
    candidateCommit: candidateCommit!,
    attentionRequired: attentionRequired!,
    observationCount: observationCount!,
    waitCount: waitCount!,
    humanPromptCount: humanPromptCount! as 0 | 1,
    externalWriteAttemptCount: externalWriteAttemptCount! as 0 | 1,
    stopCode: stopCode!,
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

function parseNullableStopCode(
  value: unknown,
  issues: ValidationIssue[],
): ReleaseRunStopCode | null | undefined {
  if (value === null) {
    return null;
  }
  return parseNestedVocabulary(
    value,
    RELEASE_RUN_STOP_CODES,
    "$.stopCode",
    issues,
  );
}
