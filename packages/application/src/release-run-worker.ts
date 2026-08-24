import type { ReleaseStewardObservationResult } from "@quietops/agent";

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
  readonly phase: "FIRST_OBSERVATION";
  readonly recheckProposal: {
    readonly waitUntil: string;
    readonly durationMs: number;
    readonly policyProfile: string;
  };
}

export type ReleaseRunObservationRunner = (
  request: Readonly<ReleaseRunObservationRequest>,
) => Promise<Readonly<ReleaseStewardObservationResult>>;

export interface ReleaseRunWorkerOptions {
  readonly service: ReleaseRunService;
  readonly workerId: string;
  readonly runObservation: ReleaseRunObservationRunner;
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
      signal: ReleaseStewardObservationResult["postcondition"]["signal"];
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

export class ReleaseRunWorker {
  readonly #service: ReleaseRunService;
  readonly #workerId: string;
  readonly #runObservation: ReleaseRunObservationRunner;
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

  constructor(options: ReleaseRunWorkerOptions) {
    this.#service = options.service;
    this.#workerId = requireWorkerId(options.workerId);
    this.#runObservation = options.runObservation;
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

    const operation = this.#executeOne();
    this.#inFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.#inFlight === operation) this.#inFlight = undefined;
      this.#claimedRunId = null;
    }
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
    const claim = this.#service.claimNextDue(
      this.#workerId,
      claimTime,
      this.#leaseDurationMs,
    );
    if (!claim) return Object.freeze({ status: "idle", runId: null });
    this.#claimedRunId = claim.run.runId;
    const request = observationRequest(claim, claimTime);
    const result = await this.#runObservation(request);
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
    return Object.freeze({
      status: "committed",
      runId: projection.runId,
      state: projection.state,
      version: projection.version,
      signal: result.postcondition.signal,
      toolCallCount: projection.toolCallCount,
      humanPrompts: projection.humanPrompts,
      externalWriteAttempts: projection.externalWriteAttempts,
    });
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
  if (claim.head.state !== "MONITORING" || claim.observationCount !== 0) {
    throw new Error(
      "Item 5 worker can claim only a first-observation MONITORING run.",
    );
  }
  const durationMs = claim.run.policyProfile.delayBetweenObservationsMs;
  return Object.freeze({
    runId: claim.run.runId,
    candidateCommit: claim.run.candidateCommit,
    phase: "FIRST_OBSERVATION",
    recheckProposal: Object.freeze({
      waitUntil: new Date(Date.parse(observedAt) + durationMs).toISOString(),
      durationMs,
      policyProfile: `${claim.run.policyProfile.name}@${claim.run.policyProfile.version}`,
    }),
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
