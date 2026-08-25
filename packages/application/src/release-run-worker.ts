import {
  ReleaseStewardPostconditionError,
  type ReleaseStewardIncidentActionResult,
  type ReleaseStewardObservationPhase,
  type ReleaseStewardObservationResult,
} from "@quietops/agent";
import {
  DEPLOYMENT_EVIDENCE_ERROR_CODES,
  DeploymentEvidenceError,
  HOMEPAGE_SMOKE_ERROR_CODES,
  HomepageSmokeError,
  GitHubEvidenceError,
  type GitHubIncidentPlan,
} from "@quietops/adapters";
import type { ReleaseRunSignal } from "@quietops/contracts";

import {
  ReleaseRunService,
  type ClaimedReleaseRun,
  type ReleaseRunProjection,
} from "./release-run-service.js";

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_LEASE_DURATION_MS = 15_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export interface ReleaseRunObservationRequest {
  readonly runId: string;
  readonly candidateCommit: string;
  readonly phase: Extract<
    ReleaseStewardObservationPhase,
    "FIRST_OBSERVATION" | "LATER_OBSERVATION" | "EXTENSION_OBSERVATION"
  >;
  readonly immutableEvidenceIds?: {
    readonly source: string;
    readonly ci: string;
  };
  readonly recheckProposal?: {
    readonly waitUntil: string;
    readonly durationMs: number;
    readonly policyProfile: string;
  };
}

export type ReleaseRunObservationRunner = (
  request: Readonly<ReleaseRunObservationRequest>,
) => Promise<Readonly<ReleaseStewardObservationResult>>;

export interface ReleaseRunIncidentActionRequest {
  readonly actionId: string;
  readonly plan: Readonly<GitHubIncidentPlan>;
  readonly providerTimeoutMs: number;
}

export type ReleaseRunIncidentActionRunner = (
  request: Readonly<ReleaseRunIncidentActionRequest>,
) => Promise<Readonly<ReleaseStewardIncidentActionResult>>;

export interface ReleaseRunWorkerOptions {
  readonly service: ReleaseRunService;
  readonly workerId: string;
  readonly runObservation: ReleaseRunObservationRunner;
  readonly runIncidentAction?: ReleaseRunIncidentActionRunner;
  readonly clock?: () => Date;
  readonly pollIntervalMs?: number;
  readonly leaseDurationMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly onError?: (error: unknown) => void;
}

export type ReleaseRunWorkerTickResult =
  | Readonly<{ status: "idle" | "busy" | "stopping"; runId: null }>
  | Readonly<{
      status: "committed";
      runId: string;
      state: ReleaseRunProjection["state"];
      version: number;
      signal: ReleaseRunSignal;
      toolCallCount: number;
      humanPrompts: number;
      externalWriteAttempts: number;
    }>
  | Readonly<{
      status: "stopped-before-commit";
      runId: string;
    }>;

export interface ReleaseRunWorkerShutdownResult {
  readonly started: boolean;
  readonly drained: boolean;
  readonly claimedRunId: string | null;
}

export interface ReleaseRunWorkerReadiness {
  readonly started: boolean;
  readonly heartbeatFresh: boolean;
  readonly lastHeartbeatAt: string | null;
}

export class ReleaseRunWorker {
  readonly #service: ReleaseRunService;
  readonly #workerId: string;
  readonly #runObservation: ReleaseRunObservationRunner;
  readonly #runIncidentAction: ReleaseRunIncidentActionRunner | undefined;
  readonly #clock: () => Date;
  readonly #pollIntervalMs: number;
  readonly #leaseDurationMs: number;
  readonly #shutdownTimeoutMs: number;
  readonly #onError: (error: unknown) => void;

  #timer: ReturnType<typeof setTimeout> | undefined;
  #inFlight: Promise<ReleaseRunWorkerTickResult> | undefined;
  #claimedRunId: string | null = null;
  #started = false;
  #stopping = false;
  #lastHeartbeatAt: string | null = null;

  constructor(options: ReleaseRunWorkerOptions) {
    this.#service = options.service;
    this.#workerId = requireWorkerId(options.workerId);
    this.#runObservation = options.runObservation;
    this.#runIncidentAction = options.runIncidentAction;
    this.#clock = options.clock ?? (() => new Date());
    this.#pollIntervalMs = boundedDuration(
      options.pollIntervalMs,
      DEFAULT_POLL_INTERVAL_MS,
      5,
      60_000,
      "pollIntervalMs",
    );
    this.#leaseDurationMs = boundedDuration(
      options.leaseDurationMs,
      DEFAULT_LEASE_DURATION_MS,
      100,
      5 * 60_000,
      "leaseDurationMs",
    );
    this.#shutdownTimeoutMs = boundedDuration(
      options.shutdownTimeoutMs,
      DEFAULT_SHUTDOWN_TIMEOUT_MS,
      100,
      30_000,
      "shutdownTimeoutMs",
    );
    this.#onError = options.onError ?? (() => undefined);
  }

  start(): boolean {
    if (this.#stopping) {
      throw new Error("A stopped release worker cannot be restarted.");
    }
    if (this.#started) return false;
    this.#started = true;
    this.#schedule(0);
    return true;
  }

  async tick(): Promise<ReleaseRunWorkerTickResult> {
    if (this.#stopping)
      return Object.freeze({ status: "stopping", runId: null });
    if (this.#inFlight) return Object.freeze({ status: "busy", runId: null });

    this.#lastHeartbeatAt = this.#now();
    const operation = this.#executeOne();
    this.#inFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.#inFlight === operation) this.#inFlight = undefined;
      this.#claimedRunId = null;
    }
  }

  getReadiness(): Readonly<ReleaseRunWorkerReadiness> {
    const heartbeatAt = this.#lastHeartbeatAt;
    const ageMs = heartbeatAt
      ? this.#clock().getTime() - Date.parse(heartbeatAt)
      : Number.POSITIVE_INFINITY;
    const heartbeatFresh =
      this.#started &&
      !this.#stopping &&
      ageMs >= 0 &&
      ageMs <=
        Math.max(100, this.#pollIntervalMs * 3, this.#leaseDurationMs * 2);
    return Object.freeze({
      started: this.#started && !this.#stopping,
      heartbeatFresh,
      lastHeartbeatAt: heartbeatAt,
    });
  }

  async stop(): Promise<Readonly<ReleaseRunWorkerShutdownResult>> {
    const wasStarted = this.#started;
    this.#stopping = true;
    this.#started = false;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    const inFlight = this.#inFlight;
    if (!inFlight) {
      return Object.freeze({
        started: wasStarted,
        drained: true,
        claimedRunId: this.#claimedRunId,
      });
    }

    const drained = await Promise.race([
      inFlight.then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolve) => {
        setTimeout(() => resolve(false), this.#shutdownTimeoutMs);
      }),
    ]);
    return Object.freeze({
      started: wasStarted,
      drained,
      claimedRunId: this.#claimedRunId,
    });
  }

  #schedule(delayMs: number): void {
    if (!this.#started || this.#stopping) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.tick()
        .catch((error: unknown) => this.#onError(error))
        .finally(() => this.#schedule(this.#pollIntervalMs));
    }, delayMs);
    this.#timer.unref?.();
  }

  async #executeOne(): Promise<ReleaseRunWorkerTickResult> {
    const claimTime = this.#now();
    this.#service.recoverAbandonedWork(claimTime);
    const claim = this.#service.claimNextDue(
      this.#workerId,
      claimTime,
      this.#leaseDurationMs,
    );
    if (!claim) return Object.freeze({ status: "idle", runId: null });
    this.#claimedRunId = claim.run.runId;
    if (claim.head.state === "WAITING") {
      const projection = this.#service.wakeDueRun(claim, claimTime);
      return committedTick(projection, "WAIT_DUE");
    }
    if (claim.head.state === "AWAITING_DECISION") {
      const projection = this.#service.expireDecision(claim, claimTime);
      return committedTick(projection, "DECISION_EXPIRED");
    }
    if (claim.head.state === "RESUMING") {
      if (!this.#runIncidentAction) {
        throw new Error(
          "Release worker cannot resume an incident without injected action authority.",
        );
      }
      const begun = this.#service.beginIncidentAction(claim, claimTime);
      let actionResult:
        Readonly<ReleaseStewardIncidentActionResult> | undefined;
      try {
        actionResult = await this.#runIncidentAction({
          actionId: begun.action.actionId,
          plan: begun.plan,
          providerTimeoutMs: claim.run.policyProfile.providerTimeoutMs,
        });
      } catch {
        const projection = this.#service.finishIncidentAction(
          begun.action.actionId,
          {
            status: "UNCERTAIN",
            providerRecordId: null,
            providerUrl: null,
            responseDigest: null,
            externalWriteAttempts: 1,
          },
          this.#now(),
        );
        return committedTick(projection, "ACTION_UNCERTAIN");
      }
      if (
        actionResult.requestFingerprint !== begun.plan.requestFingerprint ||
        actionResult.externalWriteAttempts !== 1
      ) {
        const projection = this.#service.finishIncidentAction(
          begun.action.actionId,
          {
            status: "UNCERTAIN",
            providerRecordId: null,
            providerUrl: null,
            responseDigest: null,
            externalWriteAttempts: 1,
          },
          this.#now(),
        );
        return committedTick(projection, "ACTION_UNCERTAIN");
      }
      const projection = this.#service.finishIncidentAction(
        begun.action.actionId,
        actionResult.action,
        this.#now(),
      );
      return committedTick(
        projection,
        actionResult.action.status === "CONFIRMED"
          ? "ACTION_CONFIRMED"
          : actionResult.action.status === "REJECTED"
            ? "ACTION_REJECTED"
            : "ACTION_UNCERTAIN",
      );
    }
    if (claim.head.state !== "MONITORING") {
      throw new Error(`Release worker cannot process ${claim.head.state}.`);
    }
    const request = observationRequest(claim, claimTime);
    let result: Readonly<ReleaseStewardObservationResult>;
    try {
      result = await this.#runObservation(request);
    } catch (error) {
      const stopSignal = classifyObservationFailure(error);
      if (!stopSignal) throw error;
      if (this.#stopping) {
        return Object.freeze({
          status: "stopped-before-commit",
          runId: claim.run.runId,
        });
      }
      const projection = this.#service.stopClaim(
        claim,
        stopSignal,
        this.#now(),
      );
      return committedTick(projection, stopSignal);
    }
    if (this.#stopping) {
      return Object.freeze({
        status: "stopped-before-commit",
        runId: claim.run.runId,
      });
    }
    const projection = this.#service.commitObservation({
      claim,
      result,
      occurredAt: this.#now(),
    });
    const signal =
      projection.state === "AWAITING_DECISION"
        ? "OBSERVATION_BUDGET_EXHAUSTED"
        : result.postcondition.signal;
    return committedTick(projection, signal);
  }

  #now(): string {
    const value = this.#clock();
    if (Number.isNaN(value.getTime())) {
      throw new Error("Release worker clock returned an invalid date.");
    }
    return value.toISOString();
  }
}

function observationRequest(
  claim: Readonly<ClaimedReleaseRun>,
  observedAt: string,
): Readonly<ReleaseRunObservationRequest> {
  if (claim.head.state !== "MONITORING") {
    throw new Error("Observation request requires one MONITORING run.");
  }
  const phase = observationPhase(claim);
  if (phase !== "FIRST_OBSERVATION" && !claim.immutableEvidence) {
    throw new Error("Later observation cannot lose immutable evidence IDs.");
  }
  const durationMs = claim.run.policyProfile.delayBetweenObservationsMs;
  return Object.freeze({
    runId: claim.run.runId,
    candidateCommit: claim.run.candidateCommit,
    phase,
    ...(claim.immutableEvidence
      ? {
          immutableEvidenceIds: Object.freeze({
            source: claim.immutableEvidence.source.evidenceId,
            ci: claim.immutableEvidence.ci.evidenceId,
          }),
        }
      : {}),
    ...(phase === "EXTENSION_OBSERVATION"
      ? {}
      : {
          recheckProposal: Object.freeze({
            waitUntil: new Date(
              Date.parse(observedAt) + durationMs,
            ).toISOString(),
            durationMs,
            policyProfile: `${claim.run.policyProfile.name}@${claim.run.policyProfile.version}`,
          }),
        }),
  });
}

function observationPhase(
  claim: Readonly<ClaimedReleaseRun>,
): ReleaseRunObservationRequest["phase"] {
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
  throw new Error("Release run cannot schedule a second human checkpoint.");
}

function classifyObservationFailure(
  error: unknown,
):
  | "EVIDENCE_INVALID"
  | "EVIDENCE_UNAVAILABLE"
  | "DEPLOYMENT_UNHEALTHY"
  | "HOMEPAGE_SMOKE_UNHEALTHY"
  | null {
  if (error instanceof HomepageSmokeError) {
    return error.code === HOMEPAGE_SMOKE_ERROR_CODES.unhealthy
      ? "HOMEPAGE_SMOKE_UNHEALTHY"
      : "EVIDENCE_UNAVAILABLE";
  }
  if (error instanceof DeploymentEvidenceError) {
    return error.code === DEPLOYMENT_EVIDENCE_ERROR_CODES.responseInvalid
      ? "DEPLOYMENT_UNHEALTHY"
      : "EVIDENCE_UNAVAILABLE";
  }
  if (error instanceof GitHubEvidenceError) return "EVIDENCE_UNAVAILABLE";
  if (error instanceof ReleaseStewardPostconditionError) {
    return "EVIDENCE_INVALID";
  }
  return null;
}

function committedTick(
  projection: Readonly<ReleaseRunProjection>,
  signal: ReleaseRunSignal,
): Extract<ReleaseRunWorkerTickResult, { status: "committed" }> {
  return Object.freeze({
    status: "committed",
    runId: projection.runId,
    state: projection.state,
    version: projection.version,
    signal,
    toolCallCount: projection.toolCallCount,
    humanPrompts: projection.humanPrompts,
    externalWriteAttempts: projection.externalWriteAttempts,
  });
}

function requireWorkerId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error("Invalid release worker ID.");
  }
  return value;
}

function boundedDuration(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < minimum ||
    resolved > maximum
  ) {
    throw new Error(
      `${label} must be an integer from ${minimum} through ${maximum}.`,
    );
  }
  return resolved;
}
