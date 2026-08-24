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
  parseDecisionChoice,
  parseDecisionEnvelope,
  parseDecisionSubmission,
  parseReleaseRunSignal,
  planReleaseRunTransition,
  type DecisionChoice,
  type DecisionEnvelope,
  type DecisionEvidenceReference,
  type DecisionSubmission,
  type PolicyProfile,
  type ReleaseRunSignal,
  type ReleaseRunState,
} from "@quietops/contracts";
import {
  ReleaseRunStateError,
  SQLiteReleaseRunLedger,
  type JsonObject,
  type StoredReleaseRun,
  type StoredReleaseRunEvent,
  type StoredReleaseRunHead,
} from "@quietops/storage";

const REPOSITORY = "YongHwan2161/quietops" as const;
const BRANCH = "main" as const;
const COMPLETION_SIGNALS = Object.freeze(["CANDIDATE_READY"] as const);
const STOP_SIGNALS = Object.freeze([
  "REQUIRED_CI_FAILED",
  "EVIDENCE_INVALID",
] as const);

type ItemSevenObservationSignal =
  | (typeof COMPLETION_SIGNALS)[number]
  | (typeof STOP_SIGNALS)[number]
  | "NORMAL_WAIT_REQUIRED"
  | "EXTENSION_READY"
  | "EXTENSION_EXHAUSTED";

export interface ImmutableObservationEvidence {
  readonly source: DecisionEvidenceReference;
  readonly ci: DecisionEvidenceReference;
}

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
  readonly waitCount: number;
  readonly decisionCount: number;
  readonly decisionChoice: DecisionChoice | null;
  readonly immutableEvidence: Readonly<ImmutableObservationEvidence> | null;
}

export interface CommitReleaseObservation {
  readonly claim: ClaimedReleaseRun;
  readonly result: Readonly<ReleaseStewardObservationResult>;
  readonly occurredAt: string;
}

export interface SubmitReleaseDecisionCommand {
  readonly decisionId: string;
  readonly submission: DecisionSubmission;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

export interface ReleaseDecisionReceipt {
  readonly decisionId: string;
  readonly runId: string;
  readonly candidateCommit: string;
  readonly choice: "WAIT_AND_RECHECK";
  readonly actor: "release-owner";
  readonly authorizedAt: string;
  readonly authorizedRunVersion: number;
  readonly nextWakeAt: string;
  readonly replayed: boolean;
  readonly externalWriteAttempts: 0;
}

export interface SubmitReleaseDecisionResult {
  readonly receipt: ReleaseDecisionReceipt;
  readonly projection: ReleaseRunProjection;
}

export class ReleaseDecisionNotFoundError extends Error {
  readonly code = "RELEASE_DECISION_NOT_FOUND" as const;

  constructor(decisionId: string) {
    super(`Release decision ${decisionId} was not found.`);
    this.name = "ReleaseDecisionNotFoundError";
  }
}

export class ReleaseDecisionExpiredError extends Error {
  readonly code = "RELEASE_DECISION_EXPIRED" as const;

  constructor(decisionId: string) {
    super(`Release decision ${decisionId} has expired.`);
    this.name = "ReleaseDecisionExpiredError";
  }
}

export class ReleaseDecisionChoiceUnavailableError extends Error {
  readonly code = "RELEASE_DECISION_CHOICE_UNAVAILABLE" as const;

  constructor() {
    super("Incident escalation remains unavailable before checklist Item 8.");
    this.name = "ReleaseDecisionChoiceUnavailableError";
  }
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
  readonly waitCount: number;
  readonly measuredWaitMs: number;
  readonly decisionCount: number;
  readonly nextWakeAt: string | null;
  readonly activeDecisionId: string | null;
  readonly decisionEnvelope: DecisionEnvelope | null;
  readonly evidenceCount: number;
  readonly toolCallCount: number;
  readonly humanPrompts: number;
  readonly externalWriteAttempts: number;
  readonly quietCompletion: boolean;
}

export interface ReleaseRunServiceOptions {
  readonly idFactory?: (kind: "event" | "cycle" | "decision") => string;
}

export class ReleaseRunService {
  readonly #ledger: SQLiteReleaseRunLedger;
  readonly #idFactory: (kind: "event" | "cycle" | "decision") => string;

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
    const events = this.#ledger.listEvents(run.runId);
    return Object.freeze({
      run,
      head,
      observationCount: countEvents(events, "observation-recorded"),
      waitCount: countEvents(events, "wait-scheduled"),
      decisionCount: countEvents(events, "decision-requested"),
      decisionChoice: readRecordedDecisionChoice(events),
      immutableEvidence: readImmutableObservationEvidence(events),
    });
  }

  submitDecision(
    command: Readonly<SubmitReleaseDecisionCommand>,
  ): Readonly<SubmitReleaseDecisionResult> {
    const submission = parseDecisionSubmission(command.submission);
    const requestEvent = this.#ledger.findDecisionRequest(command.decisionId);
    if (!requestEvent) {
      throw new ReleaseDecisionNotFoundError(command.decisionId);
    }
    const envelope = parseDecisionEnvelope(
      requestEvent.payload.decisionEnvelope,
    );
    if (
      envelope.decisionId !== command.decisionId ||
      envelope.runId !== requestEvent.runId
    ) {
      throw new Error("Stored decision envelope identity is invalid.");
    }
    if (submission.choice !== "WAIT_AND_RECHECK") {
      throw new ReleaseDecisionChoiceUnavailableError();
    }

    const waitUntil = new Date(
      Date.parse(command.occurredAt) +
        envelope.policyProfile.authorizedExtensionMs,
    ).toISOString();
    let stored;
    try {
      stored = this.#ledger.recordDecision({
        decisionId: envelope.decisionId,
        runId: envelope.runId,
        candidateCommit: envelope.candidateCommit,
        expectedRunVersion: submission.expectedRunVersion,
        idempotencyKey: command.idempotencyKey,
        eventId: this.#idFactory("event"),
        actionEventId: null,
        choice: submission.choice,
        actor: "release-owner",
        occurredAt: command.occurredAt,
        waitUntil,
        action: null,
      });
    } catch (error) {
      if (
        error instanceof ReleaseRunStateError &&
        command.occurredAt >= envelope.expiresAt
      ) {
        throw new ReleaseDecisionExpiredError(command.decisionId);
      }
      throw error;
    }

    const authorization = readDecisionAuthorization(
      this.#ledger.listEvents(envelope.runId),
      envelope.decisionId,
    );
    return Object.freeze({
      receipt: Object.freeze({
        decisionId: envelope.decisionId,
        runId: envelope.runId,
        candidateCommit: envelope.candidateCommit,
        choice: "WAIT_AND_RECHECK",
        actor: "release-owner",
        authorizedAt: authorization.occurredAt,
        authorizedRunVersion: stored.version,
        nextWakeAt: authorization.nextWakeAt,
        replayed: stored.replayed,
        externalWriteAttempts: 0,
      }),
      projection: this.getProjection(envelope.runId),
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
    const expectedPhase = expectedObservationPhase(claim);
    if (result.phase !== expectedPhase) {
      throw new Error(
        `Observation phase ${result.phase} does not match ${expectedPhase}.`,
      );
    }
    if (result.phase === "LATER_OBSERVATION" && !claim.immutableEvidence) {
      throw new Error(
        "Later observation is missing immutable source and CI evidence.",
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
      ...(claim.immutableEvidence
        ? {
            immutableEvidenceIds: {
              source: claim.immutableEvidence.source.evidenceId,
              ci: claim.immutableEvidence.ci.evidenceId,
            },
          }
        : {}),
      modelNarration: result.modelNarration,
    });
    assertReportedPostcondition(result, verifiedPostcondition);
    assertToolCallCounts(result);
    const signal = requireItemSevenObservationSignal(
      verifiedPostcondition.signal,
    );

    const observationSequence = claim.head.version + 1;
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

    const nextObservationCount = claim.observationCount + 1;
    if (signal === "NORMAL_WAIT_REQUIRED") {
      if (claim.decisionCount !== 0) {
        throw new Error(
          "An authorized extension cannot request another decision.",
        );
      }
      assertPolicyClampedRecheck(result, claim.run.policyProfile);
      if (
        nextObservationCount <
        claim.run.policyProfile.normalDeploymentObservations
      ) {
        const nextWakeAt = new Date(
          Date.parse(command.occurredAt) +
            claim.run.policyProfile.delayBetweenObservationsMs,
        ).toISOString();
        const waitEvent = transitionEvent({
          eventId: this.#idFactory("event"),
          sequence: observationSequence + 1,
          eventType: "wait-scheduled",
          occurredAt: command.occurredAt,
          signal,
          nextWakeAt,
          activeDecisionId: null,
        });
        this.#appendTransition(claim, [observationEvent, waitEvent], {
          state: "WAITING",
          nextWakeAt,
          activeDecisionId: null,
          updatedAt: command.occurredAt,
        });
        return this.getProjection(claim.run.runId);
      }

      if (claim.waitCount + 1 !== nextObservationCount) {
        throw new Error(
          "Normal observation history is not a single bounded wait chain.",
        );
      }
      const decisionId = this.#idFactory("decision");
      const expiresAt = new Date(
        Date.parse(command.occurredAt) +
          claim.run.policyProfile.humanDecisionTtlMs,
      ).toISOString();
      const envelope = buildDecisionEnvelope({
        decisionId,
        claim,
        result,
        observationCount: nextObservationCount,
        expectedRunVersion: observationSequence + 1,
        createdAt: command.occurredAt,
        expiresAt,
      });
      const decisionEvent = transitionEvent({
        eventId: this.#idFactory("event"),
        sequence: observationSequence + 1,
        eventType: "decision-requested",
        occurredAt: command.occurredAt,
        signal: "OBSERVATION_BUDGET_EXHAUSTED",
        nextWakeAt: expiresAt,
        activeDecisionId: decisionId,
        additionalPayload: {
          decisionId,
          decisionEnvelope: decisionEnvelopePayload(envelope),
        },
      });
      this.#appendTransition(claim, [observationEvent, decisionEvent], {
        state: "AWAITING_DECISION",
        nextWakeAt: expiresAt,
        activeDecisionId: decisionId,
        updatedAt: command.occurredAt,
      });
      return this.getProjection(claim.run.runId);
    }

    const transition = requireTransition(claim.head.state, signal);
    const terminalEvent = transitionEvent({
      eventId: this.#idFactory("event"),
      sequence: observationSequence + 1,
      eventType:
        transition.nextState === "COMPLETED" ? "run-completed" : "run-stopped",
      occurredAt: command.occurredAt,
      signal,
      nextWakeAt: null,
      activeDecisionId: null,
    });

    this.#appendTransition(claim, [observationEvent, terminalEvent], {
      state: transition.nextState,
      nextWakeAt: null,
      activeDecisionId: null,
      updatedAt: command.occurredAt,
    });
    return this.getProjection(claim.run.runId);
  }

  wakeDueRun(
    claim: Readonly<ClaimedReleaseRun>,
    occurredAt: string,
  ): Readonly<ReleaseRunProjection> {
    if (
      claim.head.state !== "WAITING" ||
      claim.head.leaseOwner === null ||
      claim.head.nextWakeAt === null ||
      claim.head.nextWakeAt > occurredAt
    ) {
      throw new Error("Wake requires one leased, due WAITING run.");
    }
    const event = transitionEvent({
      eventId: this.#idFactory("event"),
      sequence: claim.head.version + 1,
      eventType: "run-woke",
      occurredAt,
      signal: "WAIT_DUE",
      nextWakeAt: null,
      activeDecisionId: null,
    });
    this.#appendTransition(claim, [event], {
      state: "MONITORING",
      nextWakeAt: null,
      activeDecisionId: null,
      updatedAt: occurredAt,
    });
    return this.getProjection(claim.run.runId);
  }

  expireDecision(
    claim: Readonly<ClaimedReleaseRun>,
    occurredAt: string,
  ): Readonly<ReleaseRunProjection> {
    if (
      claim.head.state !== "AWAITING_DECISION" ||
      claim.head.leaseOwner === null ||
      claim.head.nextWakeAt === null ||
      claim.head.nextWakeAt > occurredAt
    ) {
      throw new Error("Expiry requires one leased, expired decision.");
    }
    return this.stopClaim(claim, "DECISION_EXPIRED", occurredAt);
  }

  stopClaim(
    claim: Readonly<ClaimedReleaseRun>,
    signal: Extract<
      ReleaseRunSignal,
      | "EVIDENCE_INVALID"
      | "EVIDENCE_UNAVAILABLE"
      | "DEPLOYMENT_UNHEALTHY"
      | "HOMEPAGE_SMOKE_UNHEALTHY"
      | "DECISION_EXPIRED"
    >,
    occurredAt: string,
  ): Readonly<ReleaseRunProjection> {
    if (claim.head.leaseOwner === null) {
      throw new Error("Stop requires one leased run.");
    }
    const transition = requireTransition(claim.head.state, signal);
    const event = transitionEvent({
      eventId: this.#idFactory("event"),
      sequence: claim.head.version + 1,
      eventType: "run-stopped",
      occurredAt,
      signal,
      nextWakeAt: null,
      activeDecisionId: null,
    });
    this.#appendTransition(claim, [event], {
      state: transition.nextState,
      nextWakeAt: null,
      activeDecisionId: null,
      updatedAt: occurredAt,
    });
    return this.getProjection(claim.run.runId);
  }

  getProjection(runId: string): Readonly<ReleaseRunProjection> {
    const run = this.#ledger.getRun(runId);
    const head = this.#ledger.getHead(runId);
    if (!run || !head) throw new Error(`Release run ${runId} was not found.`);
    return projectReleaseRun(run, head, this.#ledger.listEvents(runId));
  }

  #appendTransition(
    claim: Readonly<ClaimedReleaseRun>,
    events: Parameters<SQLiteReleaseRunLedger["appendTransition"]>[0]["events"],
    nextHead: Parameters<
      SQLiteReleaseRunLedger["appendTransition"]
    >[0]["nextHead"],
  ): void {
    this.#ledger.appendTransition({
      runId: claim.run.runId,
      expectedVersion: claim.head.version,
      events,
      nextHead,
    });
  }
}

function observationPayload(
  cycleId: string,
  candidateCommit: string,
  result: Readonly<ReleaseStewardObservationResult>,
  signal: ItemSevenObservationSignal,
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
  let pendingWaitStartedAt: string | null = null;
  let measuredWaitMs = 0;
  let decisionEnvelope: DecisionEnvelope | null = null;

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
    if (event.eventType === "wait-scheduled") {
      pendingWaitStartedAt = event.occurredAt;
    }
    if (
      event.eventType === "decision-recorded" &&
      event.payload.choice === "WAIT_AND_RECHECK"
    ) {
      pendingWaitStartedAt = event.occurredAt;
    }
    if (event.eventType === "run-woke") {
      if (pendingWaitStartedAt === null) {
        throw new Error("Stored wake event has no preceding wait.");
      }
      measuredWaitMs +=
        Date.parse(event.occurredAt) - Date.parse(pendingWaitStartedAt);
      pendingWaitStartedAt = null;
    }
    if (event.eventType === "decision-requested") {
      decisionEnvelope = parseDecisionEnvelope(event.payload.decisionEnvelope);
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
  const waitCount =
    countEvents(events, "wait-scheduled") +
    events.filter(
      (event) =>
        event.eventType === "decision-recorded" &&
        event.payload.choice === "WAIT_AND_RECHECK",
    ).length;
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
    waitCount,
    measuredWaitMs,
    decisionCount: humanPrompts,
    nextWakeAt: head.nextWakeAt,
    activeDecisionId: head.activeDecisionId,
    decisionEnvelope,
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

function expectedObservationPhase(
  claim: Readonly<ClaimedReleaseRun>,
): "FIRST_OBSERVATION" | "LATER_OBSERVATION" | "EXTENSION_OBSERVATION" {
  if (claim.decisionCount === 0) {
    return claim.observationCount === 0
      ? "FIRST_OBSERVATION"
      : "LATER_OBSERVATION";
  }
  if (
    claim.decisionCount === 1 &&
    claim.decisionChoice === "WAIT_AND_RECHECK"
  ) {
    return "EXTENSION_OBSERVATION";
  }
  throw new Error("Release run cannot enter another observation checkpoint.");
}

function readRecordedDecisionChoice(
  events: readonly StoredReleaseRunEvent[],
): DecisionChoice | null {
  const records = events.filter(
    (event) => event.eventType === "decision-recorded",
  );
  if (records.length === 0) return null;
  if (records.length !== 1 || !records[0]) {
    throw new Error("Release run contains more than one decision record.");
  }
  return parseDecisionChoice(records[0].payload.choice);
}

function readDecisionAuthorization(
  events: readonly StoredReleaseRunEvent[],
  decisionId: string,
): Readonly<{ occurredAt: string; nextWakeAt: string }> {
  const records = events.filter(
    (event) =>
      event.eventType === "decision-recorded" &&
      event.payload.decisionId === decisionId,
  );
  const event = records[0];
  if (
    records.length !== 1 ||
    !event ||
    event.payload.choice !== "WAIT_AND_RECHECK" ||
    event.payload.actor !== "release-owner" ||
    typeof event.payload.nextWakeAt !== "string"
  ) {
    throw new Error("Stored release authorization receipt is invalid.");
  }
  return Object.freeze({
    occurredAt: event.occurredAt,
    nextWakeAt: event.payload.nextWakeAt,
  });
}

function requireItemSevenObservationSignal(
  signal: ReleaseRunSignal,
): ItemSevenObservationSignal {
  if (
    (COMPLETION_SIGNALS as readonly string[]).includes(signal) ||
    (STOP_SIGNALS as readonly string[]).includes(signal) ||
    signal === "NORMAL_WAIT_REQUIRED" ||
    signal === "EXTENSION_READY" ||
    signal === "EXTENSION_EXHAUSTED"
  ) {
    return signal as ItemSevenObservationSignal;
  }
  throw new Error(
    `Signal ${signal} is outside the Item 7 observation boundary.`,
  );
}

function requireTransition(
  currentState: ReleaseRunState,
  signal: ReleaseRunSignal,
): Extract<ReturnType<typeof planReleaseRunTransition>, { allowed: true }> {
  const transition = planReleaseRunTransition({ currentState, signal });
  if (!transition.allowed) {
    throw new Error(`Signal ${signal} cannot transition ${currentState}.`);
  }
  return transition;
}

function transitionEvent(input: {
  readonly eventId: string;
  readonly sequence: number;
  readonly eventType:
    | "wait-scheduled"
    | "run-woke"
    | "decision-requested"
    | "run-completed"
    | "run-stopped";
  readonly occurredAt: string;
  readonly signal: ReleaseRunSignal;
  readonly nextWakeAt: string | null;
  readonly activeDecisionId: string | null;
  readonly additionalPayload?: JsonObject;
}) {
  const transition = requireTransitionForEvent(input.eventType, input.signal);
  return Object.freeze({
    eventId: input.eventId,
    sequence: input.sequence,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    payload: Object.freeze({
      signal: input.signal,
      nextWakeAt: input.nextWakeAt,
      activeDecisionId: input.activeDecisionId,
      stopCode: transition.stopCode,
      ...(input.additionalPayload ?? {}),
    }) satisfies JsonObject,
  });
}

function requireTransitionForEvent(
  eventType:
    | "wait-scheduled"
    | "run-woke"
    | "decision-requested"
    | "run-completed"
    | "run-stopped",
  signal: ReleaseRunSignal,
): Extract<ReturnType<typeof planReleaseRunTransition>, { allowed: true }> {
  const currentState =
    eventType === "run-woke"
      ? "WAITING"
      : eventType === "run-stopped" && signal === "DECISION_EXPIRED"
        ? "AWAITING_DECISION"
        : "MONITORING";
  return requireTransition(currentState, signal);
}

function assertPolicyClampedRecheck(
  result: Readonly<ReleaseStewardObservationResult>,
  policyProfile: PolicyProfile,
): void {
  const evidence = result.evidence.filter(
    (item) => item.kind === "Recheck proposal",
  );
  if (
    evidence.length !== 1 ||
    evidence[0]?.durationMs !== policyProfile.delayBetweenObservationsMs
  ) {
    throw new Error("Recheck duration is not clamped to the run policy.");
  }
  const receipt = result.receipts.find(
    (item) => item.evidenceId === evidence[0]!.evidenceId,
  );
  if (
    !receipt ||
    receipt.provider !== "policy-clock" ||
    receipt.providerRecordId !==
      `${policyProfile.name}@${policyProfile.version}`
  ) {
    throw new Error("Recheck receipt is not bound to the run policy.");
  }
}

function buildDecisionEnvelope(input: {
  readonly decisionId: string;
  readonly claim: Readonly<ClaimedReleaseRun>;
  readonly result: Readonly<ReleaseStewardObservationResult>;
  readonly observationCount: number;
  readonly expectedRunVersion: number;
  readonly createdAt: string;
  readonly expiresAt: string;
}): DecisionEnvelope {
  if (!input.claim.immutableEvidence) {
    throw new Error("Decision requires immutable source and CI evidence.");
  }
  const deployment = resultEvidenceReference(input.result, "Deployed revision");
  const homepageSmoke = resultEvidenceReference(input.result, "Homepage smoke");
  const waitCount = input.claim.waitCount;
  return parseDecisionEnvelope({
    decisionId: input.decisionId,
    runId: input.claim.run.runId,
    candidateCommit: input.claim.run.candidateCommit,
    expectedRunVersion: input.expectedRunVersion,
    evidence: {
      source: input.claim.immutableEvidence.source,
      ci: input.claim.immutableEvidence.ci,
      deployment,
      homepageSmoke,
    },
    observationCount: input.observationCount,
    waitCount,
    elapsedMs: Math.max(
      0,
      Date.parse(input.createdAt) - Date.parse(input.claim.run.createdAt),
    ),
    missingContext:
      "The candidate is not deployed after the normal observation budget, while the current deployment and homepage remain healthy.",
    choices: [
      {
        choice: "WAIT_AND_RECHECK",
        summary: `Wait one final policy-bounded ${input.claim.run.policyProfile.authorizedExtensionMs} ms extension, then observe deployment and homepage once more without another decision.`,
      },
      {
        choice: "ESCALATE_INCIDENT",
        summary:
          "Authorize one bounded GitHub incident issue attempt for YongHwan2161/quietops with no automatic retry.",
      },
    ],
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    policyProfile: input.claim.run.policyProfile,
    idempotencyScope: `release-decision:${input.decisionId}`,
  });
}

function decisionEnvelopePayload(envelope: DecisionEnvelope): JsonObject {
  return JSON.parse(JSON.stringify(envelope)) as JsonObject;
}

function resultEvidenceReference(
  result: Readonly<ReleaseStewardObservationResult>,
  kind: "Deployed revision" | "Homepage smoke",
): DecisionEvidenceReference {
  const evidence = result.evidence.filter((item) => item.kind === kind);
  if (evidence.length !== 1 || !evidence[0]) {
    throw new Error(`Decision requires exactly one ${kind} evidence record.`);
  }
  const receipt = result.receipts.find(
    (item) => item.evidenceId === evidence[0]!.evidenceId,
  );
  if (!receipt) {
    throw new Error(`Decision ${kind} evidence has no receipt.`);
  }
  return Object.freeze({
    evidenceId: evidence[0].evidenceId,
    fetchedAt: receipt.fetchedAt,
  });
}

function readImmutableObservationEvidence(
  events: readonly StoredReleaseRunEvent[],
): Readonly<ImmutableObservationEvidence> | null {
  const first = events.find(
    (event) => event.eventType === "observation-recorded",
  );
  if (!first) return null;
  return Object.freeze({
    source: readStoredEvidenceReference(first, "Source revision"),
    ci: readStoredEvidenceReference(first, "CI status"),
  });
}

function readStoredEvidenceReference(
  event: StoredReleaseRunEvent,
  kind: "Source revision" | "CI status",
): DecisionEvidenceReference {
  const evidenceItems = event.payload.evidence;
  const receiptItems = event.payload.receipts;
  if (!Array.isArray(evidenceItems) || !Array.isArray(receiptItems)) {
    throw new Error("Stored observation evidence or receipts are invalid.");
  }
  const evidence = evidenceItems.filter(
    (item): item is JsonObject =>
      isJsonObject(item) &&
      item.kind === kind &&
      typeof item.evidenceId === "string",
  );
  if (evidence.length !== 1 || !evidence[0]) {
    throw new Error(`Stored observation requires exactly one ${kind}.`);
  }
  const evidenceId = evidence[0].evidenceId as string;
  const receipts = receiptItems.filter(
    (item): item is JsonObject =>
      isJsonObject(item) &&
      item.evidenceId === evidenceId &&
      typeof item.fetchedAt === "string",
  );
  if (receipts.length !== 1 || !receipts[0]) {
    throw new Error(`Stored ${kind} evidence requires exactly one receipt.`);
  }
  return Object.freeze({
    evidenceId,
    fetchedAt: receipts[0].fetchedAt as string,
  });
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
