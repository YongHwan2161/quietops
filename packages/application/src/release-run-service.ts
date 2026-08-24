import { createHash, randomUUID } from "node:crypto";

import type {
  ReleaseStewardObservationResult,
  ReleaseStewardToolReceipt,
} from "@quietops/agent";
import {
  releaseStewardToolNamesForPhase,
  validateReleaseStewardPostconditions,
} from "@quietops/agent";
import {
  parseReleaseRunSignal,
  planReleaseRunTransition,
  type PolicyProfile,
  type ReleaseRunSignal,
  type ReleaseRunState,
} from "@quietops/contracts";
import {
  SQLiteReleaseRunLedger,
  type JsonObject,
  type StoredReleaseRun,
  type StoredReleaseRunEvent,
  type StoredReleaseRunHead,
} from "@quietops/storage";

const REPOSITORY = "YongHwan2161/quietops" as const;
const BRANCH = "main" as const;
const COMPLETION_SIGNALS = Object.freeze([
  "CANDIDATE_READY",
  "EXTENSION_READY",
] as const);
const STOP_SIGNALS = Object.freeze([
  "REQUIRED_CI_FAILED",
  "EVIDENCE_INVALID",
  "EXTENSION_EXHAUSTED",
] as const);

type ItemFiveCommitSignal =
  (typeof COMPLETION_SIGNALS)[number] | (typeof STOP_SIGNALS)[number];

export interface ReleaseTriggerCommand {
  readonly candidateCommit: string;
  readonly deliveryId: string;
  readonly policyProfile: PolicyProfile;
  readonly occurredAt: string;
}

export interface ReleaseTriggerResult {
  readonly runId: string;
  readonly replayed: boolean;
  readonly projection: ReleaseRunProjection;
}

export interface ClaimedReleaseRun {
  readonly run: StoredReleaseRun;
  readonly head: StoredReleaseRunHead;
  readonly observationCount: number;
}

export interface CommitReleaseObservation {
  readonly claim: ClaimedReleaseRun;
  readonly result: Readonly<ReleaseStewardObservationResult>;
  readonly occurredAt: string;
}

export interface ReleaseRunProjection {
  readonly runId: string;
  readonly repository: typeof REPOSITORY;
  readonly branch: typeof BRANCH;
  readonly candidateCommit: string;
  readonly policyProfile: PolicyProfile;
  readonly state: ReleaseRunState;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly stateHistory: readonly ReleaseRunState[];
  readonly observationCount: number;
  readonly evidenceCount: number;
  readonly toolCallCount: number;
  readonly humanPrompts: number;
  readonly externalWriteAttempts: number;
  readonly quietCompletion: boolean;
}

export interface ReleaseRunServiceOptions {
  readonly idFactory?: (kind: "event" | "cycle") => string;
}

export class ReleaseRunService {
  readonly #ledger: SQLiteReleaseRunLedger;
  readonly #idFactory: (kind: "event" | "cycle") => string;

  constructor(
    ledger: SQLiteReleaseRunLedger,
    options: ReleaseRunServiceOptions = {},
  ) {
    this.#ledger = ledger;
    this.#idFactory =
      options.idFactory ?? ((kind) => `${kind}:${randomUUID()}`);
  }

  createFromTrigger(command: ReleaseTriggerCommand): ReleaseTriggerResult {
    const identity = releaseTriggerIdentity(command.deliveryId);
    const created = this.#ledger.createRunFromWebhook({
      runId: identity.runId,
      triggerEventId: identity.eventId,
      repository: REPOSITORY,
      branch: BRANCH,
      candidateCommit: command.candidateCommit,
      triggerDeliveryId: command.deliveryId,
      policyProfile: command.policyProfile,
      createdAt: command.occurredAt,
    });
    return Object.freeze({
      runId: created.runId,
      replayed: created.replayed,
      projection: this.getProjection(created.runId),
    });
  }

  claimNextDue(
    workerId: string,
    now: string,
    leaseDurationMs: number,
  ): Readonly<ClaimedReleaseRun> | undefined {
    const head = this.#ledger.claimNextDueRun(workerId, now, leaseDurationMs);
    if (!head) return undefined;
    const run = this.#ledger.getRun(head.runId);
    if (!run) throw new Error(`Claimed release run ${head.runId} is missing.`);
    return Object.freeze({
      run,
      head,
      observationCount: countEvents(
        this.#ledger.listEvents(run.runId),
        "observation-recorded",
      ),
    });
  }

  commitObservation(
    command: CommitReleaseObservation,
  ): Readonly<ReleaseRunProjection> {
    const { claim, result } = command;
    if (
      claim.run.runId !== claim.head.runId ||
      claim.head.state !== "MONITORING" ||
      claim.head.leaseOwner === null
    ) {
      throw new Error("Observation commit requires one leased MONITORING run.");
    }
    if (result.phase !== "FIRST_OBSERVATION" || claim.observationCount !== 0) {
      throw new Error(
        "Item 5 commits only the first observation; waiting and later cycles remain held for Item 6.",
      );
    }
    if (
      result.externalMutations !== 0 ||
      result.receipts.some((receipt) => receipt.externalMutations !== 0)
    ) {
      throw new Error(
        "Observation result is not bound to the claimed candidate or zero-write contract.",
      );
    }

    const verifiedPostcondition = validateReleaseStewardPostconditions({
      phase: result.phase,
      candidateCommit: claim.run.candidateCommit,
      evidence: result.evidence,
      receipts: result.receipts,
      modelNarration: result.modelNarration,
    });
    assertReportedPostcondition(result, verifiedPostcondition);
    assertToolCallCounts(result);
    const signal = requireItemFiveSignal(verifiedPostcondition.signal);
    const transition = planReleaseRunTransition({
      currentState: claim.head.state,
      signal,
    });
    if (!transition.allowed) {
      throw new Error(
        `Observation signal ${signal} cannot transition this run.`,
      );
    }

    const observationSequence = claim.head.version + 1;
    const terminalSequence = observationSequence + 1;
    const observationEvent = Object.freeze({
      eventId: this.#idFactory("event"),
      sequence: observationSequence,
      eventType: "observation-recorded" as const,
      occurredAt: command.occurredAt,
      payload: observationPayload(
        this.#idFactory("cycle"),
        claim.run.candidateCommit,
        result,
        signal,
      ),
    });
    const terminalEvent = Object.freeze({
      eventId: this.#idFactory("event"),
      sequence: terminalSequence,
      eventType:
        transition.nextState === "COMPLETED"
          ? ("run-completed" as const)
          : ("run-stopped" as const),
      occurredAt: command.occurredAt,
      payload: Object.freeze({
        signal,
        nextWakeAt: null,
        activeDecisionId: null,
        stopCode: transition.stopCode,
        humanPrompts: 0,
        externalWriteAttempts: 0,
      }) satisfies JsonObject,
    });

    this.#ledger.appendTransition({
      runId: claim.run.runId,
      expectedVersion: claim.head.version,
      events: [observationEvent, terminalEvent],
      nextHead: {
        state: transition.nextState,
        nextWakeAt: null,
        activeDecisionId: null,
        updatedAt: command.occurredAt,
      },
    });
    return this.getProjection(claim.run.runId);
  }

  getProjection(runId: string): Readonly<ReleaseRunProjection> {
    const run = this.#ledger.getRun(runId);
    const head = this.#ledger.getHead(runId);
    if (!run || !head) throw new Error(`Release run ${runId} was not found.`);
    return projectReleaseRun(run, head, this.#ledger.listEvents(runId));
  }
}

function observationPayload(
  cycleId: string,
  candidateCommit: string,
  result: Readonly<ReleaseStewardObservationResult>,
  signal: ItemFiveCommitSignal,
): JsonObject {
  return Object.freeze({
    cycleId,
    phase: result.phase,
    candidateCommit,
    modelMode: result.modelMode,
    policySignal: signal,
    evidence: Object.freeze(
      result.evidence.map((item) =>
        Object.freeze({
          evidenceId: item.evidenceId,
          kind: item.kind,
          status: item.status,
          value: item.value,
          ...(item.headSha ? { headSha: item.headSha } : {}),
          ...(item.durationMs !== undefined
            ? { durationMs: item.durationMs }
            : {}),
        }),
      ),
    ),
    receipts: Object.freeze(result.receipts.map(receiptPayload)),
    toolCallCounts: Object.freeze({ ...result.toolCallCounts }),
    evidenceCount: result.evidence.length,
    receiptCount: result.receipts.length,
    externalMutations: 0,
  });
}

function assertReportedPostcondition(
  result: Readonly<ReleaseStewardObservationResult>,
  verified: ReturnType<typeof validateReleaseStewardPostconditions>,
): void {
  for (const key of [
    "signal",
    "candidateCommit",
    "sourceEvidenceId",
    "ciEvidenceId",
    "deploymentEvidenceId",
    "homepageSmokeEvidenceId",
    "recheckEvidenceId",
    "externalMutations",
  ] as const) {
    if (result.postcondition[key] !== verified[key]) {
      throw new Error(
        "Reported release postcondition disagrees with deterministic evidence validation.",
      );
    }
  }
}

function assertToolCallCounts(
  result: Readonly<ReleaseStewardObservationResult>,
): void {
  const allowed = releaseStewardToolNamesForPhase(result.phase);
  const actualKeys = Object.keys(result.toolCallCounts).sort();
  if (
    actualKeys.length !== allowed.length ||
    [...allowed].sort().some((name, index) => actualKeys[index] !== name)
  ) {
    throw new Error("Tool call counts do not match the state-scoped registry.");
  }
  for (const name of allowed) {
    const receiptCount = result.receipts.filter(
      (receipt) => receipt.toolName === name,
    ).length;
    if (result.toolCallCounts[name] !== receiptCount) {
      throw new Error("Tool call counts do not match persisted receipts.");
    }
  }
}

function receiptPayload(receipt: ReleaseStewardToolReceipt): JsonObject {
  return Object.freeze({
    toolName: receipt.toolName,
    evidenceId: receipt.evidenceId,
    provider: receipt.provider,
    providerRecordId: receipt.providerRecordId,
    ...(receipt.sourceUrl ? { sourceUrl: receipt.sourceUrl } : {}),
    fetchedAt: receipt.fetchedAt,
    externalMutations: 0,
  });
}

function projectReleaseRun(
  run: StoredReleaseRun,
  head: StoredReleaseRunHead,
  events: readonly StoredReleaseRunEvent[],
): Readonly<ReleaseRunProjection> {
  const stateHistory: ReleaseRunState[] = [];
  let state: ReleaseRunState | null = null;
  let evidenceCount = 0;
  let toolCallCount = 0;

  for (const event of events) {
    if (event.eventType === "observation-recorded") {
      evidenceCount += readNonNegativeInteger(
        event.payload.evidenceCount,
        "evidenceCount",
      );
      toolCallCount += readNonNegativeInteger(
        event.payload.receiptCount,
        "receiptCount",
      );
    }
    if (event.payload.signal !== undefined) {
      const signal = parseReleaseRunSignal(event.payload.signal);
      const transition = planReleaseRunTransition({
        currentState: state,
        signal,
      });
      if (!transition.allowed) {
        throw new Error(
          "Stored release history contains a forbidden transition.",
        );
      }
      state = transition.nextState;
      stateHistory.push(state);
    }
  }
  if (state !== head.state) {
    throw new Error(
      "Stored release projection disagrees with its event history.",
    );
  }

  const observationCount = countEvents(events, "observation-recorded");
  const humanPrompts = countEvents(events, "decision-requested");
  const externalWriteAttempts = countEvents(events, "action-attempted");
  return Object.freeze({
    runId: run.runId,
    repository: run.repository,
    branch: run.branch,
    candidateCommit: run.candidateCommit,
    policyProfile: run.policyProfile,
    state: head.state,
    version: head.version,
    createdAt: run.createdAt,
    updatedAt: head.updatedAt,
    stateHistory: Object.freeze(stateHistory),
    observationCount,
    evidenceCount,
    toolCallCount,
    humanPrompts,
    externalWriteAttempts,
    quietCompletion:
      head.state === "COMPLETED" &&
      humanPrompts === 0 &&
      externalWriteAttempts === 0,
  });
}

function requireItemFiveSignal(signal: ReleaseRunSignal): ItemFiveCommitSignal {
  if (
    (COMPLETION_SIGNALS as readonly string[]).includes(signal) ||
    (STOP_SIGNALS as readonly string[]).includes(signal)
  ) {
    return signal as ItemFiveCommitSignal;
  }
  throw new Error(
    `Signal ${signal} requires a later checklist item and was not persisted.`,
  );
}

function releaseTriggerIdentity(deliveryId: string): Readonly<{
  runId: string;
  eventId: string;
}> {
  const digest = createHash("sha256")
    .update(`github-delivery:${deliveryId}`)
    .digest("hex");
  return Object.freeze({
    runId: `github:${digest}`,
    eventId: `github-trigger:${digest}`,
  });
}

function countEvents(
  events: readonly StoredReleaseRunEvent[],
  eventType: StoredReleaseRunEvent["eventType"],
): number {
  return events.filter((event) => event.eventType === eventType).length;
}

function readNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Stored ${label} is invalid.`);
  }
  return value as number;
}
