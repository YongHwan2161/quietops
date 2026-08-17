import { parseVocabularyValue } from "./validation.js";

export const EVIDENCE_STATUSES = Object.freeze([
  "Pending",
  "Checking",
  "Verified",
  "Failed",
  "Unknown",
  "Stale",
  "Not required",
] as const);

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const EVALUATION_OUTCOMES = Object.freeze([
  "Ready",
  "Needs decision",
  "Could not complete",
] as const);

export type EvaluationOutcome = (typeof EVALUATION_OUTCOMES)[number];

export const HUMAN_DECISIONS = Object.freeze([
  "Reject",
  "Re-check requested",
] as const);

export type HumanDecision = (typeof HUMAN_DECISIONS)[number];

export function parseEvidenceStatus(value: unknown): EvidenceStatus {
  return parseVocabularyValue(value, EVIDENCE_STATUSES, "evidence status");
}

export function parseEvaluationOutcome(value: unknown): EvaluationOutcome {
  return parseVocabularyValue(value, EVALUATION_OUTCOMES, "evaluation outcome");
}

export function parseHumanDecision(value: unknown): HumanDecision {
  return parseVocabularyValue(value, HUMAN_DECISIONS, "human decision");
}

export function isVerifiedEvidenceStatus(
  value: unknown,
): value is Extract<EvidenceStatus, "Verified"> {
  return value === "Verified";
}
