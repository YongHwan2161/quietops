import {
  deepFreeze,
  rejectUnknownKeys,
  requireRecord,
} from "./contract-fields.js";
import { type ExternalActionType } from "./external-action.js";
import {
  RELEASE_RUN_STATES,
  parseReleaseRunState,
  type ReleaseRunState,
  type ReleaseRunStopCode,
} from "./release-run.js";
import {
  ContractValidationError,
  parseVocabularyValue,
  type ValidationIssue,
} from "./validation.js";

export const RELEASE_RUN_SIGNALS = Object.freeze([
  "TRIGGER_ACCEPTED",
  "REQUIRED_CI_FAILED",
  "EVIDENCE_INVALID",
  "EVIDENCE_UNAVAILABLE",
  "DEPLOYMENT_UNHEALTHY",
  "HOMEPAGE_SMOKE_UNHEALTHY",
  "CANDIDATE_READY",
  "NORMAL_WAIT_REQUIRED",
  "OBSERVATION_BUDGET_EXHAUSTED",
  "WAIT_DUE",
  "WAIT_AND_RECHECK_AUTHORIZED",
  "ESCALATE_INCIDENT_AUTHORIZED",
  "DECISION_EXPIRED",
  "EXTENSION_READY",
  "EXTENSION_EXHAUSTED",
  "ACTION_CONFIRMED",
  "ACTION_REJECTED",
  "ACTION_UNCERTAIN",
  "SUPERSEDED",
  "STALE_DECISION",
] as const);
export type ReleaseRunSignal = (typeof RELEASE_RUN_SIGNALS)[number];

export interface ReleaseTransitionRequest {
  readonly currentState: ReleaseRunState | null;
  readonly signal: ReleaseRunSignal;
}

export interface AllowedReleaseTransition {
  readonly allowed: true;
  readonly currentState: ReleaseRunState | null;
  readonly signal: ReleaseRunSignal;
  readonly nextState: ReleaseRunState;
  readonly stopCode: ReleaseRunStopCode | null;
  readonly decisionRequest: boolean;
  readonly externalAction: ExternalActionType | null;
}

export interface ForbiddenReleaseTransition {
  readonly allowed: false;
  readonly currentState: ReleaseRunState | null;
  readonly signal: ReleaseRunSignal;
  readonly reason: "FORBIDDEN_TRANSITION";
}

export type ReleaseTransitionResult =
  AllowedReleaseTransition | ForbiddenReleaseTransition;

type TransitionDefinition = Omit<
  AllowedReleaseTransition,
  "allowed" | "currentState" | "signal"
>;

const TRANSITIONS = new Map<string, TransitionDefinition>();

define(null, "TRIGGER_ACCEPTED", "MONITORING");
define("MONITORING", "REQUIRED_CI_FAILED", "STOPPED", "REQUIRED_CI_FAILED");
define("MONITORING", "EVIDENCE_INVALID", "STOPPED", "EVIDENCE_INVALID");
define("MONITORING", "EVIDENCE_UNAVAILABLE", "STOPPED", "EVIDENCE_UNAVAILABLE");
define("MONITORING", "DEPLOYMENT_UNHEALTHY", "STOPPED", "DEPLOYMENT_UNHEALTHY");
define(
  "MONITORING",
  "HOMEPAGE_SMOKE_UNHEALTHY",
  "STOPPED",
  "HOMEPAGE_SMOKE_UNHEALTHY",
);
define("MONITORING", "CANDIDATE_READY", "COMPLETED");
define("MONITORING", "NORMAL_WAIT_REQUIRED", "WAITING");
define(
  "MONITORING",
  "OBSERVATION_BUDGET_EXHAUSTED",
  "AWAITING_DECISION",
  null,
  true,
);
define("MONITORING", "EXTENSION_READY", "COMPLETED");
define("MONITORING", "EXTENSION_EXHAUSTED", "STOPPED", "EXTENSION_EXHAUSTED");
define("WAITING", "WAIT_DUE", "MONITORING");
define("AWAITING_DECISION", "WAIT_AND_RECHECK_AUTHORIZED", "WAITING");
define(
  "AWAITING_DECISION",
  "ESCALATE_INCIDENT_AUTHORIZED",
  "RESUMING",
  null,
  false,
  "CREATE_GITHUB_INCIDENT",
);
define("AWAITING_DECISION", "DECISION_EXPIRED", "STOPPED", "DECISION_EXPIRED");
define("RESUMING", "ACTION_CONFIRMED", "ESCALATED");
define("RESUMING", "ACTION_REJECTED", "STOPPED", "ACTION_REJECTED");
define("RESUMING", "ACTION_UNCERTAIN", "STOPPED", "ACTION_OUTCOME_UNCERTAIN");

for (const state of [
  "MONITORING",
  "WAITING",
  "AWAITING_DECISION",
  "RESUMING",
] as const) {
  define(state, "SUPERSEDED", "STOPPED", "SUPERSEDED");
}

export const RELEASE_TRANSITION_INPUT_COUNT =
  (RELEASE_RUN_STATES.length + 1) * RELEASE_RUN_SIGNALS.length;
export const ALLOWED_RELEASE_TRANSITION_COUNT = TRANSITIONS.size;
export const FORBIDDEN_RELEASE_TRANSITION_COUNT =
  RELEASE_TRANSITION_INPUT_COUNT - ALLOWED_RELEASE_TRANSITION_COUNT;

export function parseReleaseRunSignal(value: unknown): ReleaseRunSignal {
  return parseVocabularyValue(value, RELEASE_RUN_SIGNALS, "release run signal");
}

export function planReleaseRunTransition(
  value: unknown,
): ReleaseTransitionResult {
  const request = parseTransitionRequest(value);
  const transition = TRANSITIONS.get(key(request.currentState, request.signal));

  if (transition === undefined) {
    return deepFreeze({
      allowed: false,
      currentState: request.currentState,
      signal: request.signal,
      reason: "FORBIDDEN_TRANSITION",
    });
  }

  return deepFreeze({
    allowed: true,
    currentState: request.currentState,
    signal: request.signal,
    ...transition,
  });
}

function parseTransitionRequest(value: unknown): ReleaseTransitionRequest {
  const record = requireRecord(value, "release transition request");
  const issues: ValidationIssue[] = [];
  rejectUnknownKeys(record, ["currentState", "signal"], issues);

  let currentState: ReleaseRunState | null | undefined;
  if (record.currentState === null) {
    currentState = null;
  } else {
    try {
      currentState = parseReleaseRunState(record.currentState);
    } catch (error) {
      appendNestedIssues(error, "$.currentState", issues);
    }
  }

  let signal: ReleaseRunSignal | undefined;
  try {
    signal = parseReleaseRunSignal(record.signal);
  } catch (error) {
    appendNestedIssues(error, "$.signal", issues);
  }

  if (issues.length > 0) {
    throw new ContractValidationError(
      "Invalid release transition request.",
      issues,
    );
  }

  return deepFreeze({ currentState: currentState!, signal: signal! });
}

function define(
  currentState: ReleaseRunState | null,
  signal: ReleaseRunSignal,
  nextState: ReleaseRunState,
  stopCode: ReleaseRunStopCode | null = null,
  decisionRequest = false,
  externalAction: ExternalActionType | null = null,
): void {
  const transitionKey = key(currentState, signal);
  if (TRANSITIONS.has(transitionKey)) {
    throw new Error(`Duplicate release transition: ${transitionKey}`);
  }
  TRANSITIONS.set(
    transitionKey,
    deepFreeze({
      nextState,
      stopCode,
      decisionRequest,
      externalAction,
    }),
  );
}

function key(
  currentState: ReleaseRunState | null,
  signal: ReleaseRunSignal,
): string {
  return `${currentState ?? "none"}:${signal}`;
}

function appendNestedIssues(
  error: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (error instanceof ContractValidationError) {
    for (const issue of error.issues) {
      issues.push({ ...issue, path });
    }
    return;
  }
  throw error;
}
