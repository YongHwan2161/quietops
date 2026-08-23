import {
  finishContract,
  readInteger,
  readString,
  rejectUnknownKeys,
  requireRecord,
} from "./contract-fields.js";
import { parseVocabularyValue, type ValidationIssue } from "./validation.js";

export const POLICY_PROFILE_VERSION = "1" as const;

export const POLICY_PROFILE_NAMES = Object.freeze([
  "demo-v1",
  "standard-v1",
] as const);

export type PolicyProfileName = (typeof POLICY_PROFILE_NAMES)[number];

export interface PolicyProfile {
  readonly name: PolicyProfileName;
  readonly version: typeof POLICY_PROFILE_VERSION;
  readonly normalDeploymentObservations: number;
  readonly delayBetweenObservationsMs: number;
  readonly humanDecisionTtlMs: number;
  readonly authorizedExtensionMs: number;
  readonly maxHumanDecisions: 1;
  readonly maxIncidentWriteAttempts: 1;
  readonly providerTimeoutMs: number;
}

const POLICY_KEYS = Object.freeze([
  "name",
  "version",
  "normalDeploymentObservations",
  "delayBetweenObservationsMs",
  "humanDecisionTtlMs",
  "authorizedExtensionMs",
  "maxHumanDecisions",
  "maxIncidentWriteAttempts",
  "providerTimeoutMs",
] as const);

const POLICY_PROFILES = Object.freeze({
  "demo-v1": Object.freeze({
    name: "demo-v1",
    version: POLICY_PROFILE_VERSION,
    normalDeploymentObservations: 2,
    delayBetweenObservationsMs: 5_000,
    humanDecisionTtlMs: 15 * 60_000,
    authorizedExtensionMs: 5_000,
    maxHumanDecisions: 1,
    maxIncidentWriteAttempts: 1,
    providerTimeoutMs: 8_000,
  }),
  "standard-v1": Object.freeze({
    name: "standard-v1",
    version: POLICY_PROFILE_VERSION,
    normalDeploymentObservations: 3,
    delayBetweenObservationsMs: 60_000,
    humanDecisionTtlMs: 30 * 60_000,
    authorizedExtensionMs: 60_000,
    maxHumanDecisions: 1,
    maxIncidentWriteAttempts: 1,
    providerTimeoutMs: 8_000,
  }),
} satisfies Record<PolicyProfileName, PolicyProfile>);

export function parsePolicyProfileName(value: unknown): PolicyProfileName {
  return parseVocabularyValue(
    value,
    POLICY_PROFILE_NAMES,
    "policy profile name",
  );
}

export function resolvePolicyProfile(name: PolicyProfileName): PolicyProfile {
  return POLICY_PROFILES[name];
}

export function parsePolicyProfile(value: unknown): PolicyProfile {
  const record = requireRecord(value, "policy profile");
  const issues: ValidationIssue[] = [];
  rejectUnknownKeys(record, POLICY_KEYS, issues);

  const rawName = readString(record, "name", issues);
  const rawVersion = readString(record, "version", issues);
  const values = {
    normalDeploymentObservations: readInteger(
      record,
      "normalDeploymentObservations",
      issues,
      { minimum: 1 },
    ),
    delayBetweenObservationsMs: readInteger(
      record,
      "delayBetweenObservationsMs",
      issues,
      { minimum: 1 },
    ),
    humanDecisionTtlMs: readInteger(record, "humanDecisionTtlMs", issues, {
      minimum: 1,
    }),
    authorizedExtensionMs: readInteger(
      record,
      "authorizedExtensionMs",
      issues,
      { minimum: 1 },
    ),
    maxHumanDecisions: readInteger(record, "maxHumanDecisions", issues, {
      minimum: 1,
      maximum: 1,
    }),
    maxIncidentWriteAttempts: readInteger(
      record,
      "maxIncidentWriteAttempts",
      issues,
      { minimum: 1, maximum: 1 },
    ),
    providerTimeoutMs: readInteger(record, "providerTimeoutMs", issues, {
      minimum: 1,
    }),
  };

  let profile: PolicyProfile | undefined;
  if (rawName !== undefined) {
    if ((POLICY_PROFILE_NAMES as readonly string[]).includes(rawName)) {
      profile = POLICY_PROFILES[rawName as PolicyProfileName];
    } else {
      issues.push({
        code: "invalid_value",
        message: `Expected one of: ${POLICY_PROFILE_NAMES.join(", ")}.`,
        path: "$.name",
      });
    }
  }

  if (rawVersion !== undefined && rawVersion !== POLICY_PROFILE_VERSION) {
    issues.push({
      code: "invalid_value",
      message: `Expected policy profile version ${POLICY_PROFILE_VERSION}.`,
      path: "$.version",
    });
  }

  if (profile !== undefined) {
    for (const [key, actual] of Object.entries(values)) {
      if (
        actual !== undefined &&
        actual !== profile[key as keyof PolicyProfile]
      ) {
        issues.push({
          code: "invalid_value",
          message: "Resolved policy values must match the named profile.",
          path: `$.${key}`,
        });
      }
    }
  }

  return finishContract("policy profile", issues, profile!);
}
