import {
  deepFreeze,
  finishContract,
  readInteger,
  readString,
  readUtcTimestamp,
  rejectUnknownKeys,
  requireRecord,
} from "./contract-fields.js";
import { parsePolicyProfile, type PolicyProfile } from "./policy-profile.js";
import { parseVocabularyValue, type ValidationIssue } from "./validation.js";

export const DECISION_CHOICES = Object.freeze([
  "WAIT_AND_RECHECK",
  "ESCALATE_INCIDENT",
] as const);

export type DecisionChoice = (typeof DECISION_CHOICES)[number];

export interface DecisionEvidenceReference {
  readonly evidenceId: string;
  readonly fetchedAt: string;
}

export interface DecisionEvidenceSet {
  readonly source: DecisionEvidenceReference;
  readonly ci: DecisionEvidenceReference;
  readonly deployment: DecisionEvidenceReference;
  readonly homepageSmoke: DecisionEvidenceReference;
}

export interface DecisionConsequence {
  readonly choice: DecisionChoice;
  readonly summary: string;
}

export interface DecisionEnvelope {
  readonly decisionId: string;
  readonly runId: string;
  readonly candidateCommit: string;
  readonly expectedRunVersion: number;
  readonly evidence: DecisionEvidenceSet;
  readonly observationCount: number;
  readonly waitCount: number;
  readonly elapsedMs: number;
  readonly missingContext: string;
  readonly choices: readonly [DecisionConsequence, DecisionConsequence];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly policyProfile: PolicyProfile;
  readonly idempotencyScope: string;
}

export interface DecisionSubmission {
  readonly choice: DecisionChoice;
  readonly expectedRunVersion: number;
}

const ENVELOPE_KEYS = Object.freeze([
  "decisionId",
  "runId",
  "candidateCommit",
  "expectedRunVersion",
  "evidence",
  "observationCount",
  "waitCount",
  "elapsedMs",
  "missingContext",
  "choices",
  "createdAt",
  "expiresAt",
  "policyProfile",
  "idempotencyScope",
] as const);
const EVIDENCE_KEYS = Object.freeze([
  "source",
  "ci",
  "deployment",
  "homepageSmoke",
] as const);
const EVIDENCE_REFERENCE_KEYS = Object.freeze([
  "evidenceId",
  "fetchedAt",
] as const);
const CONSEQUENCE_KEYS = Object.freeze(["choice", "summary"] as const);
const SUBMISSION_KEYS = Object.freeze([
  "choice",
  "expectedRunVersion",
] as const);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export function parseDecisionChoice(value: unknown): DecisionChoice {
  return parseVocabularyValue(value, DECISION_CHOICES, "decision choice");
}

export function parseDecisionSubmission(value: unknown): DecisionSubmission {
  const record = requireRecord(value, "decision submission");
  const issues: ValidationIssue[] = [];
  rejectUnknownKeys(record, SUBMISSION_KEYS, issues);
  const choice = parseNestedChoice(record.choice, "$.choice", issues);
  const expectedRunVersion = readInteger(record, "expectedRunVersion", issues, {
    minimum: 1,
  });

  return finishContract("decision submission", issues, {
    choice: choice!,
    expectedRunVersion: expectedRunVersion!,
  });
}

export function parseDecisionEnvelope(value: unknown): DecisionEnvelope {
  const record = requireRecord(value, "decision envelope");
  const issues: ValidationIssue[] = [];
  rejectUnknownKeys(record, ENVELOPE_KEYS, issues);

  const decisionId = readString(record, "decisionId", issues, {
    minLength: 1,
    maxLength: 128,
    pattern: IDENTIFIER_PATTERN,
  });
  const runId = readString(record, "runId", issues, {
    minLength: 1,
    maxLength: 128,
    pattern: IDENTIFIER_PATTERN,
  });
  const candidateCommit = readString(record, "candidateCommit", issues, {
    minLength: 40,
    maxLength: 40,
    pattern: COMMIT_PATTERN,
  });
  const expectedRunVersion = readInteger(record, "expectedRunVersion", issues, {
    minimum: 1,
  });
  const observationCount = readInteger(record, "observationCount", issues, {
    minimum: 1,
  });
  const waitCount = readInteger(record, "waitCount", issues, { minimum: 0 });
  const elapsedMs = readInteger(record, "elapsedMs", issues, { minimum: 0 });
  const missingContext = readString(record, "missingContext", issues, {
    minLength: 1,
    maxLength: 500,
  });
  const createdAt = readUtcTimestamp(record, "createdAt", issues);
  const expiresAt = readUtcTimestamp(record, "expiresAt", issues);
  const idempotencyScope = readString(record, "idempotencyScope", issues, {
    minLength: 1,
    maxLength: 256,
  });

  const evidence = parseEvidenceSet(record.evidence, issues);
  const choices = parseConsequences(record.choices, issues);
  const policyProfile = parseNestedPolicy(record.policyProfile, issues);

  if (
    createdAt !== undefined &&
    expiresAt !== undefined &&
    expiresAt <= createdAt
  ) {
    issues.push({
      code: "invalid_value",
      message: "Decision expiry must be after creation.",
      path: "$.expiresAt",
    });
  }
  if (
    decisionId !== undefined &&
    idempotencyScope !== undefined &&
    idempotencyScope !== `release-decision:${decisionId}`
  ) {
    issues.push({
      code: "invalid_value",
      message: "Idempotency scope must be bound to the decision identifier.",
      path: "$.idempotencyScope",
    });
  }

  return finishContract("decision envelope", issues, {
    decisionId: decisionId!,
    runId: runId!,
    candidateCommit: candidateCommit!,
    expectedRunVersion: expectedRunVersion!,
    evidence: evidence!,
    observationCount: observationCount!,
    waitCount: waitCount!,
    elapsedMs: elapsedMs!,
    missingContext: missingContext!,
    choices: choices!,
    createdAt: createdAt!,
    expiresAt: expiresAt!,
    policyProfile: policyProfile!,
    idempotencyScope: idempotencyScope!,
  });
}

function parseEvidenceSet(
  value: unknown,
  issues: ValidationIssue[],
): DecisionEvidenceSet | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push({
      code: "invalid_type",
      message: "Expected an evidence object.",
      path: "$.evidence",
    });
    return undefined;
  }
  const record = value as Record<string, unknown>;
  rejectUnknownKeys(record, EVIDENCE_KEYS, issues, "$.evidence");

  const source = parseEvidenceReference(record.source, "source", issues);
  const ci = parseEvidenceReference(record.ci, "ci", issues);
  const deployment = parseEvidenceReference(
    record.deployment,
    "deployment",
    issues,
  );
  const homepageSmoke = parseEvidenceReference(
    record.homepageSmoke,
    "homepageSmoke",
    issues,
  );

  if (
    [source, ci, deployment, homepageSmoke].some((item) => item === undefined)
  ) {
    return undefined;
  }
  return deepFreeze({
    source: source!,
    ci: ci!,
    deployment: deployment!,
    homepageSmoke: homepageSmoke!,
  });
}

function parseEvidenceReference(
  value: unknown,
  key: string,
  issues: ValidationIssue[],
): DecisionEvidenceReference | undefined {
  const path = `$.evidence.${key}`;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push({ code: "invalid_type", message: "Expected an object.", path });
    return undefined;
  }
  const record = value as Record<string, unknown>;
  rejectUnknownKeys(record, EVIDENCE_REFERENCE_KEYS, issues, path);
  const evidenceId = readString(record, "evidenceId", issues, {
    path,
    minLength: 1,
    maxLength: 256,
  });
  const fetchedAt = readUtcTimestamp(record, "fetchedAt", issues, path);
  if (evidenceId === undefined || fetchedAt === undefined) {
    return undefined;
  }
  return deepFreeze({ evidenceId, fetchedAt });
}

function parseConsequences(
  value: unknown,
  issues: ValidationIssue[],
): readonly [DecisionConsequence, DecisionConsequence] | undefined {
  if (!Array.isArray(value) || value.length !== DECISION_CHOICES.length) {
    issues.push({
      code: "invalid_value",
      message: "Expected exactly the two ordered decision choices.",
      path: "$.choices",
    });
    return undefined;
  }

  const parsed = value.map((entry, index) => {
    const path = `$.choices[${index}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      issues.push({
        code: "invalid_type",
        message: "Expected an object.",
        path,
      });
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    rejectUnknownKeys(record, CONSEQUENCE_KEYS, issues, path);
    const choice = parseNestedChoice(record.choice, `${path}.choice`, issues);
    const summary = readString(record, "summary", issues, {
      path,
      minLength: 1,
      maxLength: 500,
    });
    if (choice !== DECISION_CHOICES[index]) {
      issues.push({
        code: "invalid_value",
        message: "Decision choices must be complete and in canonical order.",
        path: `${path}.choice`,
      });
    }
    if (choice === undefined || summary === undefined) {
      return undefined;
    }
    return deepFreeze({ choice, summary });
  });

  if (parsed.some((entry) => entry === undefined)) {
    return undefined;
  }
  return deepFreeze(parsed as [DecisionConsequence, DecisionConsequence]);
}

function parseNestedChoice(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): DecisionChoice | undefined {
  if (
    typeof value !== "string" ||
    !(DECISION_CHOICES as readonly string[]).includes(value)
  ) {
    issues.push({
      code: typeof value === "string" ? "invalid_value" : "invalid_type",
      message: `Expected one of: ${DECISION_CHOICES.join(", ")}.`,
      path,
    });
    return undefined;
  }
  return value as DecisionChoice;
}

function parseNestedPolicy(
  value: unknown,
  issues: ValidationIssue[],
): PolicyProfile | undefined {
  try {
    return parsePolicyProfile(value);
  } catch (error) {
    if (error instanceof Error && "issues" in error) {
      for (const issue of (error as { issues: readonly ValidationIssue[] })
        .issues) {
        issues.push({
          ...issue,
          path: `$.policyProfile${issue.path.slice(1)}`,
        });
      }
      return undefined;
    }
    throw error;
  }
}
