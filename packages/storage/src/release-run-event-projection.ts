import {
  RELEASE_RUN_STOP_CODES,
  parseReleaseRunSignal,
  planReleaseRunTransition,
  type ReleaseRunSignal,
  type ReleaseRunState,
} from "@quietops/contracts";

import type { JsonObject, JsonValue } from "./sqlite-evaluation-ledger.js";

export const RELEASE_RUN_EVENT_TYPES = Object.freeze([
  "release-triggered",
  "observation-recorded",
  "wait-scheduled",
  "run-woke",
  "decision-requested",
  "decision-recorded",
  "action-reserved",
  "action-attempted",
  "action-confirmed",
  "action-rejected",
  "action-uncertain",
  "run-completed",
  "run-stopped",
  "run-superseded",
] as const);
export type ReleaseRunEventType = (typeof RELEASE_RUN_EVENT_TYPES)[number];

export interface NewReleaseRunEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly eventType: ReleaseRunEventType;
  readonly occurredAt: string;
  readonly payload: JsonObject;
}

export interface StoredReleaseRunEvent extends NewReleaseRunEvent {
  readonly runId: string;
}

export interface RebuiltReleaseRunHead {
  readonly runId: string;
  readonly state: ReleaseRunState;
  readonly version: number;
  readonly nextWakeAt: string | null;
  readonly activeDecisionId: string | null;
  readonly leaseOwner: null;
  readonly leaseExpiresAt: null;
  readonly updatedAt: string;
}

const MAX_EVENT_PAYLOAD_BYTES = 16 * 1_024;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FORBIDDEN_PAYLOAD_KEY_PATTERN =
  /^(authorization|headers?|raw[-_]?body|signature|.*secret.*|.*token.*)$/i;

const EVENT_SIGNALS = Object.freeze({
  "release-triggered": Object.freeze(["TRIGGER_ACCEPTED"]),
  "observation-recorded": Object.freeze([]),
  "wait-scheduled": Object.freeze(["NORMAL_WAIT_REQUIRED"]),
  "run-woke": Object.freeze(["WAIT_DUE"]),
  "decision-requested": Object.freeze(["OBSERVATION_BUDGET_EXHAUSTED"]),
  "decision-recorded": Object.freeze([
    "WAIT_AND_RECHECK_AUTHORIZED",
    "ESCALATE_INCIDENT_AUTHORIZED",
  ]),
  "action-reserved": Object.freeze([]),
  "action-attempted": Object.freeze([]),
  "action-confirmed": Object.freeze(["ACTION_CONFIRMED"]),
  "action-rejected": Object.freeze(["ACTION_REJECTED"]),
  "action-uncertain": Object.freeze(["ACTION_UNCERTAIN"]),
  "run-completed": Object.freeze(["CANDIDATE_READY", "EXTENSION_READY"]),
  "run-stopped": Object.freeze([
    "REQUIRED_CI_FAILED",
    "EVIDENCE_INVALID",
    "EVIDENCE_UNAVAILABLE",
    "DEPLOYMENT_UNHEALTHY",
    "HOMEPAGE_SMOKE_UNHEALTHY",
    "DECISION_EXPIRED",
    "EXTENSION_EXHAUSTED",
  ]),
  "run-superseded": Object.freeze(["SUPERSEDED"]),
} satisfies Record<ReleaseRunEventType, readonly ReleaseRunSignal[]>);

export function rebuildReleaseRunHead(
  runId: string,
  events: readonly StoredReleaseRunEvent[],
): RebuiltReleaseRunHead {
  assertIdentifier(runId, "run ID");
  if (events.length === 0) {
    throw new Error("A release run requires at least one event.");
  }

  let state: ReleaseRunState | null = null;
  let nextWakeAt: string | null = null;
  let activeDecisionId: string | null = null;
  let updatedAt = "";

  for (const [index, event] of events.entries()) {
    if (event.runId !== runId) {
      throw new Error("Release run event belongs to a different run.");
    }
    if (event.sequence !== index + 1) {
      throw new Error("Release run event sequence must be contiguous.");
    }
    assertIdentifier(event.eventId, "event ID");
    assertUtcTimestamp(event.occurredAt, "event timestamp");
    if (updatedAt !== "" && event.occurredAt < updatedAt) {
      throw new Error("Release run event timestamps must be monotonic.");
    }
    assertSafeJsonObject(event.payload, "release run event payload");

    const allowedSignals = EVENT_SIGNALS[event.eventType];
    const rawSignal = event.payload.signal;
    if (allowedSignals.length === 0) {
      if (rawSignal !== undefined) {
        throw new Error(
          `${event.eventType} must not carry a transition signal.`,
        );
      }
      if (state === null || isTerminal(state)) {
        throw new Error(
          `${event.eventType} is invalid for the current run state.`,
        );
      }
      assertNoProjectionMetadata(event.payload);
    } else {
      const signal = parseReleaseRunSignal(rawSignal);
      if (!(allowedSignals as readonly string[]).includes(signal)) {
        throw new Error(`${signal} is not valid for ${event.eventType}.`);
      }
      const transition = planReleaseRunTransition({
        currentState: state,
        signal,
      });
      if (!transition.allowed) {
        throw new Error(
          `Forbidden persisted transition ${state ?? "none"}:${signal}.`,
        );
      }

      state = transition.nextState;
      nextWakeAt = readNullableTimestamp(event.payload, "nextWakeAt");
      activeDecisionId = readNullableIdentifier(
        event.payload,
        "activeDecisionId",
      );
      const stopCode = event.payload.stopCode ?? null;
      if (stopCode !== transition.stopCode) {
        throw new Error(
          "Persisted stop code does not match the transition kernel.",
        );
      }
      assertProjectionMetadata(state, nextWakeAt, activeDecisionId);
    }
    updatedAt = event.occurredAt;
  }

  if (state === null) {
    throw new Error("Release run history did not establish a state.");
  }

  return deepFreeze({
    runId,
    state,
    version: events.length,
    nextWakeAt,
    activeDecisionId,
    leaseOwner: null,
    leaseExpiresAt: null,
    updatedAt,
  });
}

export function assertSafeJsonObject(value: JsonObject, label: string): void {
  const serialized = canonicalJson(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_EVENT_PAYLOAD_BYTES) {
    throw new Error(`${label} exceeds ${MAX_EVENT_PAYLOAD_BYTES} bytes.`);
  }
  inspectJsonValue(value, label);
}

export function parseStoredJsonObject(
  value: string,
  label: string,
): JsonObject {
  const parsed: unknown = JSON.parse(value);
  if (!isJsonObject(parsed)) {
    throw new Error(`Stored ${label} is not a JSON object.`);
  }
  assertSafeJsonObject(parsed, label);
  return deepFreeze(parsed);
}

export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
}

export function assertUtcTimestamp(value: string, label: string): void {
  try {
    if (
      !UTC_TIMESTAMP_PATTERN.test(value) ||
      new Date(value).toISOString() !== value
    ) {
      throw new Error("invalid timestamp");
    }
  } catch {
    throw new Error(`Invalid ${label}.`);
  }
}

function assertNoProjectionMetadata(payload: JsonObject): void {
  for (const key of ["nextWakeAt", "activeDecisionId", "stopCode"]) {
    if (payload[key] !== undefined) {
      throw new Error(
        "Non-transition events cannot change the run projection.",
      );
    }
  }
}

function assertProjectionMetadata(
  state: ReleaseRunState,
  nextWakeAt: string | null,
  activeDecisionId: string | null,
): void {
  const expectsWake = state === "WAITING" || state === "AWAITING_DECISION";
  if (expectsWake !== (nextWakeAt !== null)) {
    throw new Error("Persisted wake time does not match the next state.");
  }
  if ((state === "AWAITING_DECISION") !== (activeDecisionId !== null)) {
    throw new Error(
      "Persisted decision identity does not match the next state.",
    );
  }
}

function readNullableTimestamp(
  payload: JsonObject,
  key: string,
): string | null {
  const value = payload[key] ?? null;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`Invalid ${key}.`);
  }
  assertUtcTimestamp(value, key);
  return value;
}

function readNullableIdentifier(
  payload: JsonObject,
  key: string,
): string | null {
  const value = payload[key] ?? null;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`Invalid ${key}.`);
  }
  assertIdentifier(value, key);
  return value;
}

function inspectJsonValue(value: JsonValue, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectJsonValue(item, `${path}[${index}]`));
    return;
  }
  if (!isJsonObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PAYLOAD_KEY_PATTERN.test(key)) {
      throw new Error(`${path} contains forbidden sensitive field ${key}.`);
    }
    inspectJsonValue(child, `${path}.${key}`);
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

function isTerminal(state: ReleaseRunState): boolean {
  return state === "COMPLETED" || state === "ESCALATED" || state === "STOPPED";
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
