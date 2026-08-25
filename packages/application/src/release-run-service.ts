import { createHash, randomUUID } from "node:crypto";

import type {
  GitHubIncidentActionResult,
  GitHubIncidentEvidenceLink,
  GitHubIncidentPlan,
} from "@quietops/adapters";
import { buildGitHubIncidentPlan } from "@quietops/adapters";
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
  isTerminalReleaseRunState,
  parseReleaseRunPublicProjection,
  parseReleaseRunSignal,
  parseReleaseRunStopCode,
  planReleaseRunTransition,
  type DecisionChoice,
  type DecisionEnvelope,
  type DecisionEvidenceReference,
  type DecisionSubmission,
  type PolicyProfile,
  type ReleaseRunPublicProjection,
  type ReleaseRunSignal,
  type ReleaseRunState,
  type ReleaseRunStopCode,
} from "@quietops/contracts";
import {
  ReleaseRunStateError,
  SQLiteReleaseRunLedger,
  type JsonObject,
  type RecoverAbandonedWorkResult,
  type StoredReleaseRun,
  type StoredExternalAction,
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
  readonly externalAction: Readonly<StoredExternalAction> | null;
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
  readonly choice: DecisionChoice;
  readonly actor: "release-owner";
  readonly authorizedAt: string;
  readonly authorizedRunVersion: number;
  readonly nextWakeAt: string | null;
  readonly actionId: string | null;
  readonly requestFingerprint: string | null;
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

export class ReleaseRunNotFoundError extends Error {
  readonly code = "RELEASE_RUN_NOT_FOUND" as const;

  constructor(runId: string) {
    super(`Release run ${runId} was not found.`);
    this.name = "ReleaseRunNotFoundError";
  }
}

export interface BegunIncidentAction {
  readonly action: Readonly<StoredExternalAction>;
  readonly plan: Readonly<GitHubIncidentPlan>;
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
  readonly stopCode: ReleaseRunStopCode | null;
}

export type ReleaseRunEvidenceMode = "live" | "preserved-demo";

export interface ReleaseRunInboxProjection extends ReleaseRunPublicProjection {
  readonly evidenceMode: ReleaseRunEvidenceMode;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly active: boolean;
  readonly headline: string;
  readonly summary: string;
}

export interface ReleaseRunTimelineProjection {
  readonly sequence: number;
  readonly eventType: StoredReleaseRunEvent["eventType"];
  readonly occurredAt: string;
  readonly title: string;
  readonly detail: string;
}

export interface ReleaseRunReceiptProjection {
  readonly toolName: string;
  readonly evidenceId: string;
  readonly provider: string;
  readonly providerRecordId: string;
  readonly sourceUrl: string | null;
  readonly fetchedAt: string;
}

export interface ReleaseRunDecisionProjection {
  readonly decisionId: string;
  readonly status: "PENDING" | "AUTHORIZED" | "EXPIRED";
  readonly missingContext: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly expectedRunVersion: number;
  readonly choices: DecisionEnvelope["choices"];
  readonly authorizedChoice: DecisionChoice | null;
  readonly authorizedAt: string | null;
}

export interface ReleaseRunActionProjection {
  readonly actionId: string;
  readonly actionType: "CREATE_GITHUB_INCIDENT";
  readonly status: StoredExternalAction["status"];
  readonly attemptCount: 0 | 1;
  readonly requestFingerprint: string;
  readonly providerRecordId: string | null;
  readonly providerUrl: string | null;
  readonly responseDigest: string | null;
}

export interface ReleaseRunDetailProjection extends ReleaseRunInboxProjection {
  readonly repository: typeof REPOSITORY;
  readonly branch: typeof BRANCH;
  readonly version: number;
  readonly policyProfile: string;
  readonly nextWakeAt: string | null;
  readonly measuredWaitMs: number;
  readonly decision: Readonly<ReleaseRunDecisionProjection> | null;
  readonly action: Readonly<ReleaseRunActionProjection> | null;
  readonly timeline: readonly Readonly<ReleaseRunTimelineProjection>[];
  readonly receipts: readonly Readonly<ReleaseRunReceiptProjection>[];
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
    const actionId = readReservedActionId(events);
    return Object.freeze({
      run,
      head,
      observationCount: countEvents(events, "observation-recorded"),
      waitCount: countEvents(events, "wait-scheduled"),
      decisionCount: countEvents(events, "decision-requested"),
      decisionChoice: readRecordedDecisionChoice(events),
      immutableEvidence: readImmutableObservationEvidence(events),
      externalAction: actionId
        ? (this.#ledger.getExternalAction(actionId) ?? null)
        : null,
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
    const decisionRun = this.#ledger.getRun(envelope.runId);
    if (
      !decisionRun ||
      releaseRunEvidenceMode(decisionRun) === "preserved-demo"
    ) {
      throw new ReleaseRunStateError(
        "Preserved demonstration runs cannot accept operator decisions.",
      );
    }
    const existingAuthorization = findDecisionAuthorization(
      this.#ledger.listEvents(envelope.runId),
      envelope.decisionId,
    );
    const authorizedAt =
      existingAuthorization?.occurredAt ?? command.occurredAt;
    const waitUntil =
      submission.choice === "WAIT_AND_RECHECK"
        ? new Date(
            Date.parse(authorizedAt) +
              envelope.policyProfile.authorizedExtensionMs,
          ).toISOString()
        : null;
    const incidentPlan =
      submission.choice === "ESCALATE_INCIDENT"
        ? this.#buildIncidentPlan(envelope, authorizedAt)
        : null;
    const actionId = incidentPlan
      ? incidentActionId(envelope.decisionId)
      : null;
    let stored;
    try {
      stored = this.#ledger.recordDecision({
        decisionId: envelope.decisionId,
        runId: envelope.runId,
        candidateCommit: envelope.candidateCommit,
        expectedRunVersion: submission.expectedRunVersion,
        idempotencyKey: command.idempotencyKey,
        eventId: this.#idFactory("event"),
        actionEventId: actionId ? this.#idFactory("event") : null,
        choice: submission.choice,
        actor: "release-owner",
        occurredAt: authorizedAt,
        waitUntil,
        action:
          actionId && incidentPlan
            ? {
                actionId,
                requestFingerprint: incidentPlan.requestFingerprint,
              }
            : null,
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
        choice: authorization.choice,
        actor: "release-owner",
        authorizedAt: authorization.occurredAt,
        authorizedRunVersion: stored.version,
        nextWakeAt: authorization.nextWakeAt,
        actionId: authorization.actionId,
        requestFingerprint: authorization.requestFingerprint,
        replayed: stored.replayed,
        externalWriteAttempts: 0,
      }),
      projection: this.getProjection(envelope.runId),
    });
  }

  recoverAbandonedWork(now: string): Readonly<RecoverAbandonedWorkResult> {
    return this.#ledger.recoverAbandonedWork(now);
  }

  beginIncidentAction(
    claim: Readonly<ClaimedReleaseRun>,
    occurredAt: string,
  ): Readonly<BegunIncidentAction> {
    if (
      claim.head.state !== "RESUMING" ||
      claim.head.leaseOwner === null ||
      claim.decisionChoice !== "ESCALATE_INCIDENT" ||
      claim.externalAction === null
    ) {
      throw new Error("Incident action requires one leased RESUMING run.");
    }
    if (
      claim.externalAction.status !== "RESERVED" ||
      claim.externalAction.attemptCount !== 0
    ) {
      throw new Error("Incident action is not available for a first attempt.");
    }
    if (
      claim.head.leaseExpiresAt === null ||
      Date.parse(claim.head.leaseExpiresAt) - Date.parse(occurredAt) <
        claim.run.policyProfile.providerTimeoutMs + 1_000
    ) {
      throw new Error(
        "Incident action lease must outlast the provider timeout boundary.",
      );
    }
    const requestEvent = this.#ledger.findDecisionRequest(
      readRequiredDecisionId(this.#ledger.listEvents(claim.run.runId)),
    );
    if (!requestEvent) {
      throw new Error("Incident action decision request is missing.");
    }
    const envelope = parseDecisionEnvelope(
      requestEvent.payload.decisionEnvelope,
    );
    const authorization = readDecisionAuthorization(
      this.#ledger.listEvents(claim.run.runId),
      envelope.decisionId,
    );
    const plan = this.#buildIncidentPlan(envelope, authorization.occurredAt);
    if (plan.requestFingerprint !== claim.externalAction.requestFingerprint) {
      throw new Error(
        "Reserved incident fingerprint no longer matches evidence.",
      );
    }
    const action = this.#ledger.beginExternalAction({
      actionId: claim.externalAction.actionId,
      expectedRunVersion: claim.head.version,
      eventId: this.#idFactory("event"),
      occurredAt,
    });
    return Object.freeze({ action, plan });
  }

  finishIncidentAction(
    actionId: string,
    result: Readonly<GitHubIncidentActionResult>,
    occurredAt: string,
  ): Readonly<ReleaseRunProjection> {
    const finished = this.#ledger.finishExternalAction({
      actionId,
      idempotencyKey: `finish:${actionId}`,
      eventId: this.#idFactory("event"),
      occurredAt,
      result,
    });
    return this.getProjection(finished.runId);
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
    if (!run || !head) throw new ReleaseRunNotFoundError(runId);
    return projectReleaseRun(run, head, this.#ledger.listEvents(runId));
  }

  listPublicRuns(): readonly Readonly<ReleaseRunInboxProjection>[] {
    const items = this.#ledger.listRuns().map((run) => {
      const head = this.#ledger.getHead(run.runId);
      if (!head) {
        throw new Error(`Release run ${run.runId} is missing its head.`);
      }
      return projectReleaseRunInbox(
        run,
        projectReleaseRun(run, head, this.#ledger.listEvents(run.runId)),
      );
    });
    return Object.freeze(items.sort(compareReleaseRunInbox));
  }

  getPublicRunDetail(runId: string): Readonly<ReleaseRunDetailProjection> {
    const run = this.#ledger.getRun(runId);
    const head = this.#ledger.getHead(runId);
    if (!run || !head) throw new ReleaseRunNotFoundError(runId);
    const events = this.#ledger.listEvents(runId);
    const projection = projectReleaseRun(run, head, events);
    const actionId = readReservedActionId(events);
    const action = actionId
      ? (this.#ledger.getExternalAction(actionId) ?? null)
      : null;
    return projectReleaseRunDetail(run, projection, events, action);
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

  #buildIncidentPlan(
    envelope: Readonly<DecisionEnvelope>,
    authorizedAt: string,
  ): Readonly<GitHubIncidentPlan> {
    const run = this.#ledger.getRun(envelope.runId);
    if (!run || run.candidateCommit !== envelope.candidateCommit) {
      throw new Error("Incident decision no longer matches its release run.");
    }
    const events = this.#ledger.listEvents(envelope.runId);
    const projection = projectReleaseRun(
      run,
      this.#ledger.getHead(envelope.runId)!,
      events,
    );
    return buildGitHubIncidentPlan({
      runId: envelope.runId,
      candidateCommit: envelope.candidateCommit,
      decisionId: envelope.decisionId,
      authorizedAt,
      observationCount: envelope.observationCount,
      measuredWaitMs: projection.measuredWaitMs,
      evidence: {
        source: readIncidentEvidenceLink(events, envelope.evidence.source),
        ci: readIncidentEvidenceLink(events, envelope.evidence.ci),
        deployment: readIncidentEvidenceLink(
          events,
          envelope.evidence.deployment,
        ),
        homepageSmoke: readIncidentEvidenceLink(
          events,
          envelope.evidence.homepageSmoke,
        ),
      },
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
    stopCode: readLatestStopCode(events),
  });
}

function projectReleaseRunInbox(
  run: Readonly<StoredReleaseRun>,
  projection: Readonly<ReleaseRunProjection>,
): Readonly<ReleaseRunInboxProjection> {
  const publicProjection = parseReleaseRunPublicProjection({
    runId: run.runId,
    state: projection.state,
    candidateCommit: run.candidateCommit,
    attentionRequired: projection.state === "AWAITING_DECISION",
    observationCount: projection.observationCount,
    waitCount: projection.waitCount,
    humanPromptCount: projection.humanPrompts,
    externalWriteAttemptCount: projection.externalWriteAttempts,
    stopCode: projection.stopCode,
  });
  const message = releaseRunMessage(projection);
  return Object.freeze({
    ...publicProjection,
    evidenceMode: releaseRunEvidenceMode(run),
    createdAt: run.createdAt,
    updatedAt: projection.updatedAt,
    active: !isTerminalReleaseRunState(projection.state),
    headline: message.headline,
    summary: message.summary,
  });
}

function projectReleaseRunDetail(
  run: Readonly<StoredReleaseRun>,
  projection: Readonly<ReleaseRunProjection>,
  events: readonly StoredReleaseRunEvent[],
  action: Readonly<StoredExternalAction> | null,
): Readonly<ReleaseRunDetailProjection> {
  const inbox = projectReleaseRunInbox(run, projection);
  return Object.freeze({
    ...inbox,
    repository: run.repository,
    branch: run.branch,
    version: projection.version,
    policyProfile: `${run.policyProfile.name}@${run.policyProfile.version}`,
    nextWakeAt: projection.nextWakeAt,
    measuredWaitMs: projection.measuredWaitMs,
    decision: projectReleaseDecision(projection, events),
    action: action
      ? Object.freeze({
          actionId: action.actionId,
          actionType: action.actionType,
          status: action.status,
          attemptCount: action.attemptCount,
          requestFingerprint: action.requestFingerprint,
          providerRecordId: action.providerRecordId,
          providerUrl: action.providerUrl,
          responseDigest: action.responseDigest,
        })
      : null,
    timeline: Object.freeze(events.map(projectTimelineEvent)),
    receipts: Object.freeze(projectReleaseReceipts(events)),
  });
}

function projectReleaseDecision(
  projection: Readonly<ReleaseRunProjection>,
  events: readonly StoredReleaseRunEvent[],
): Readonly<ReleaseRunDecisionProjection> | null {
  const envelope = projection.decisionEnvelope;
  if (!envelope) return null;
  const record = events.find(
    (event) => event.eventType === "decision-recorded",
  );
  const authorizedChoice = record
    ? parseDecisionChoice(record.payload.choice)
    : null;
  return Object.freeze({
    decisionId: envelope.decisionId,
    status: record
      ? "AUTHORIZED"
      : projection.stopCode === "DECISION_EXPIRED"
        ? "EXPIRED"
        : "PENDING",
    missingContext: envelope.missingContext,
    createdAt: envelope.createdAt,
    expiresAt: envelope.expiresAt,
    expectedRunVersion: envelope.expectedRunVersion,
    choices: envelope.choices,
    authorizedChoice,
    authorizedAt: record?.occurredAt ?? null,
  });
}

function projectTimelineEvent(
  event: Readonly<StoredReleaseRunEvent>,
): Readonly<ReleaseRunTimelineProjection> {
  const text = timelineMessage(event);
  return Object.freeze({
    sequence: event.sequence,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    title: text.title,
    detail: text.detail,
  });
}

function projectReleaseReceipts(
  events: readonly StoredReleaseRunEvent[],
): readonly Readonly<ReleaseRunReceiptProjection>[] {
  const receipts: ReleaseRunReceiptProjection[] = [];
  for (const event of events) {
    if (event.eventType !== "observation-recorded") continue;
    const rawReceipts = event.payload.receipts;
    if (!Array.isArray(rawReceipts)) {
      throw new Error("Stored observation receipts are invalid.");
    }
    for (const raw of rawReceipts) {
      if (
        !isJsonObject(raw) ||
        typeof raw.toolName !== "string" ||
        typeof raw.evidenceId !== "string" ||
        typeof raw.provider !== "string" ||
        typeof raw.providerRecordId !== "string" ||
        (raw.sourceUrl !== undefined && typeof raw.sourceUrl !== "string") ||
        typeof raw.fetchedAt !== "string"
      ) {
        throw new Error("Stored observation receipt is invalid.");
      }
      receipts.push(
        Object.freeze({
          toolName: raw.toolName,
          evidenceId: raw.evidenceId,
          provider: raw.provider,
          providerRecordId: raw.providerRecordId,
          sourceUrl: raw.sourceUrl ?? null,
          fetchedAt: raw.fetchedAt,
        }),
      );
    }
  }
  return receipts;
}

function releaseRunMessage(
  projection: Readonly<ReleaseRunProjection>,
): Readonly<{ headline: string; summary: string }> {
  switch (projection.state) {
    case "MONITORING":
      return Object.freeze({
        headline: "QuietOps is checking the release",
        summary: "The agent is collecting bounded release evidence.",
      });
    case "WAITING":
      return Object.freeze({
        headline: "QuietOps is absorbing rollout delay",
        summary: "A policy-bounded wait was stored before the agent slept.",
      });
    case "AWAITING_DECISION":
      return Object.freeze({
        headline: "Your judgment is needed",
        summary:
          projection.decisionEnvelope?.missingContext ??
          "The safe autonomous budget ended with one context-dependent choice.",
      });
    case "RESUMING":
      return Object.freeze({
        headline: "Your decision is being carried out",
        summary:
          "QuietOps resumed the same release run with bounded authority.",
      });
    case "COMPLETED":
      return projection.quietCompletion
        ? Object.freeze({
            headline: "Released without interrupting you",
            summary: `QuietOps completed ${projection.observationCount} observation cycle${projection.observationCount === 1 ? "" : "s"} with zero human prompts and zero external writes.`,
          })
        : Object.freeze({
            headline: "Release completed after your decision",
            summary:
              "The original run resumed and reached its verified candidate.",
          });
    case "ESCALATED":
      return Object.freeze({
        headline: "Incident escalation confirmed",
        summary:
          "One authorized incident attempt returned a bound provider receipt.",
      });
    case "STOPPED":
      return Object.freeze({
        headline: "QuietOps stopped safely",
        summary: stopCodeMessage(projection.stopCode),
      });
  }
}

function timelineMessage(
  event: Readonly<StoredReleaseRunEvent>,
): Readonly<{ title: string; detail: string }> {
  switch (event.eventType) {
    case "release-triggered":
      return Object.freeze({
        title: "Release detected",
        detail: "A fixed main-branch event created this durable run.",
      });
    case "observation-recorded":
      return Object.freeze({
        title: "Agent observation committed",
        detail: `${readNonNegativeInteger(event.payload.receiptCount, "receiptCount")} bounded tool receipt${event.payload.receiptCount === 1 ? " was" : "s were"} stored without external writes.`,
      });
    case "wait-scheduled":
      return Object.freeze({
        title: "Routine delay absorbed",
        detail: "QuietOps stored its next wake time before sleeping.",
      });
    case "run-woke":
      return Object.freeze({
        title: "Observation resumed",
        detail: "The same run woke at its policy boundary.",
      });
    case "decision-requested":
      return Object.freeze({
        title: "Human context requested",
        detail:
          "Safe observation was exhausted while the current release remained healthy.",
      });
    case "decision-recorded":
      return Object.freeze({
        title: "Owner decision authorized",
        detail:
          event.payload.choice === "ESCALATE_INCIDENT"
            ? "One evidence-bound incident attempt was authorized."
            : "One final bounded wait and re-check was authorized.",
      });
    case "action-reserved":
      return Object.freeze({
        title: "Incident action reserved",
        detail:
          "The immutable request fingerprint was stored before provider access.",
      });
    case "action-attempted":
      return Object.freeze({
        title: "Incident attempt started",
        detail: "The one-attempt budget was consumed before the provider call.",
      });
    case "action-confirmed":
      return Object.freeze({
        title: "Incident confirmed",
        detail: "GitHub returned one repository-bound issue receipt.",
      });
    case "action-rejected":
      return Object.freeze({
        title: "Incident rejected",
        detail:
          "The provider deterministically rejected the authorized request.",
      });
    case "action-uncertain":
      return Object.freeze({
        title: "Incident outcome uncertain",
        detail:
          "QuietOps stopped without retrying an ambiguous provider outcome.",
      });
    case "run-completed":
      return Object.freeze({
        title: "Release complete",
        detail: "The candidate and user-facing smoke evidence converged.",
      });
    case "run-stopped":
      return Object.freeze({
        title: "Run stopped safely",
        detail: stopCodeMessage(readEventStopCode(event)),
      });
    case "run-superseded":
      return Object.freeze({
        title: "Run superseded",
        detail: "A newer release candidate replaced this run.",
      });
  }
}

function releaseRunEvidenceMode(
  run: Readonly<StoredReleaseRun>,
): ReleaseRunEvidenceMode {
  return run.triggerDeliveryId.startsWith("preserved-demo:")
    ? "preserved-demo"
    : "live";
}

function compareReleaseRunInbox(
  left: Readonly<ReleaseRunInboxProjection>,
  right: Readonly<ReleaseRunInboxProjection>,
): number {
  if (left.attentionRequired !== right.attentionRequired) {
    return left.attentionRequired ? -1 : 1;
  }
  if (left.active !== right.active) return left.active ? -1 : 1;
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.runId.localeCompare(right.runId)
  );
}

function readLatestStopCode(
  events: readonly StoredReleaseRunEvent[],
): ReleaseRunStopCode | null {
  for (const event of [...events].reverse()) {
    if (
      event.payload.stopCode !== undefined &&
      event.payload.stopCode !== null
    ) {
      return parseReleaseRunStopCode(event.payload.stopCode);
    }
  }
  return null;
}

function readEventStopCode(
  event: Readonly<StoredReleaseRunEvent>,
): ReleaseRunStopCode {
  if (event.payload.stopCode === null || event.payload.stopCode === undefined) {
    throw new Error("Stored stopped event has no stop code.");
  }
  return parseReleaseRunStopCode(event.payload.stopCode);
}

function stopCodeMessage(code: ReleaseRunStopCode | null): string {
  const messages: Readonly<Record<ReleaseRunStopCode, string>> = Object.freeze({
    REQUIRED_CI_FAILED:
      "Required CI failed, so no release action was attempted.",
    EVIDENCE_INVALID: "Evidence contradicted the release identity contract.",
    EVIDENCE_UNAVAILABLE: "Required evidence could not be obtained safely.",
    DEPLOYMENT_UNHEALTHY: "The currently deployed revision was not healthy.",
    HOMEPAGE_SMOKE_UNHEALTHY: "The user-facing homepage smoke check failed.",
    DECISION_EXPIRED:
      "The decision expired without silently choosing for the owner.",
    EXTENSION_EXHAUSTED:
      "The one authorized extension ended without convergence.",
    ACTION_REJECTED: "The provider rejected the authorized incident request.",
    ACTION_OUTCOME_UNCERTAIN:
      "The provider outcome was ambiguous, so QuietOps did not retry.",
    SUPERSEDED: "A newer candidate replaced this release run.",
  });
  return code
    ? messages[code]
    : "The run ended at a deterministic safety boundary.";
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
): Readonly<{
  occurredAt: string;
  choice: DecisionChoice;
  nextWakeAt: string | null;
  actionId: string | null;
  requestFingerprint: string | null;
}> {
  const authorization = findDecisionAuthorization(events, decisionId);
  if (!authorization) {
    throw new Error("Stored release authorization receipt is invalid.");
  }
  return authorization;
}

function findDecisionAuthorization(
  events: readonly StoredReleaseRunEvent[],
  decisionId: string,
): Readonly<{
  occurredAt: string;
  choice: DecisionChoice;
  nextWakeAt: string | null;
  actionId: string | null;
  requestFingerprint: string | null;
}> | null {
  const records = events.filter(
    (event) =>
      event.eventType === "decision-recorded" &&
      event.payload.decisionId === decisionId,
  );
  if (records.length === 0) return null;
  const event = records[0];
  if (
    records.length !== 1 ||
    !event ||
    event.payload.actor !== "release-owner"
  ) {
    throw new Error("Stored release authorization receipt is invalid.");
  }
  const choice = parseDecisionChoice(event.payload.choice);
  const actionEvent =
    choice === "ESCALATE_INCIDENT"
      ? events.find((candidate) => candidate.eventType === "action-reserved")
      : undefined;
  if (
    (choice === "WAIT_AND_RECHECK" &&
      typeof event.payload.nextWakeAt !== "string") ||
    (choice === "ESCALATE_INCIDENT" &&
      (event.payload.nextWakeAt !== null ||
        !actionEvent ||
        typeof actionEvent.payload.actionId !== "string" ||
        typeof actionEvent.payload.requestFingerprint !== "string"))
  ) {
    throw new Error("Stored release authorization receipt is invalid.");
  }
  return Object.freeze({
    occurredAt: event.occurredAt,
    choice,
    nextWakeAt:
      typeof event.payload.nextWakeAt === "string"
        ? event.payload.nextWakeAt
        : null,
    actionId:
      typeof actionEvent?.payload.actionId === "string"
        ? actionEvent.payload.actionId
        : null,
    requestFingerprint:
      typeof actionEvent?.payload.requestFingerprint === "string"
        ? actionEvent.payload.requestFingerprint
        : null,
  });
}

function readReservedActionId(
  events: readonly StoredReleaseRunEvent[],
): string | null {
  const reservations = events.filter(
    (event) => event.eventType === "action-reserved",
  );
  if (reservations.length === 0) return null;
  if (
    reservations.length !== 1 ||
    typeof reservations[0]?.payload.actionId !== "string"
  ) {
    throw new Error("Stored incident action reservation is invalid.");
  }
  return reservations[0].payload.actionId;
}

function readRequiredDecisionId(
  events: readonly StoredReleaseRunEvent[],
): string {
  const requests = events.filter(
    (event) => event.eventType === "decision-requested",
  );
  if (
    requests.length !== 1 ||
    typeof requests[0]?.payload.decisionId !== "string"
  ) {
    throw new Error("Stored release decision request is invalid.");
  }
  return requests[0].payload.decisionId;
}

function readIncidentEvidenceLink(
  events: readonly StoredReleaseRunEvent[],
  reference: Readonly<DecisionEvidenceReference>,
): Readonly<GitHubIncidentEvidenceLink> {
  const matches: GitHubIncidentEvidenceLink[] = [];
  for (const event of events) {
    if (event.eventType !== "observation-recorded") continue;
    const receipts = event.payload.receipts;
    if (!Array.isArray(receipts)) continue;
    for (const receipt of receipts) {
      if (
        isJsonObject(receipt) &&
        receipt.evidenceId === reference.evidenceId &&
        receipt.fetchedAt === reference.fetchedAt &&
        typeof receipt.sourceUrl === "string"
      ) {
        matches.push({
          evidenceId: reference.evidenceId,
          fetchedAt: reference.fetchedAt,
          sourceUrl: receipt.sourceUrl,
        });
      }
    }
  }
  const uniqueMatches = [
    ...new Map(
      matches.map((match) => [
        `${match.evidenceId}\n${match.fetchedAt}\n${match.sourceUrl}`,
        match,
      ]),
    ).values(),
  ];
  if (uniqueMatches.length !== 1 || !uniqueMatches[0]) {
    throw new Error(
      `Incident evidence ${reference.evidenceId} requires one bound source URL.`,
    );
  }
  return Object.freeze(uniqueMatches[0]);
}

function incidentActionId(decisionId: string): string {
  return `github-incident:${createHash("sha256")
    .update(`release-decision:${decisionId}`)
    .digest("hex")}`;
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
