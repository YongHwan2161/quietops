import { randomUUID } from "node:crypto";

import {
  EVIDENCE_KINDS,
  EVIDENCE_TOOL_NAMES,
  LIVE_GITHUB_EVIDENCE_TOOL_NAMES,
  MISMATCH_FIXTURE,
  READY_FIXTURE,
  runLiveGitHubSourceCiSlice,
  runReleaseSlice,
  type EvidenceKind,
  type EvidenceObservation,
  type FixtureReleaseScenario,
  type LiveGitHubSourceCiSliceResult,
  type ReleaseFixture,
  type ReleaseScenario,
  type ReleaseSliceResult,
  type ToolCallReceipt,
} from "@quietops/agent";
import {
  parseCandidateIdentity,
  parseEvaluationOutcome,
  parseHumanDecision,
  type CandidateIdentity,
  type EvaluationOutcome,
  type HumanDecision,
} from "@quietops/contracts";
import {
  SQLiteEvaluationLedger,
  type JsonObject,
  type NewEvaluationRecord,
  type NewLedgerEvent,
  type StoredEvaluationRecord,
  type StoredLedgerEvent,
} from "@quietops/storage";

const DEMO_REPOSITORY = "YongHwan2161/quietops";
const DEMO_BRANCH = "main";
const DEMO_DEPLOYMENT_URL = "https://quietops.example.invalid/releases/demo";
const LIVE_GITHUB_INCOMPLETE_DEPLOYMENT_URL =
  "https://quietops.example.invalid/releases/live-github-source-ci";

const EVENT_TYPES = Object.freeze({
  started: "evaluation-started",
  evidence: "evidence-recorded",
  policy: "policy-evaluated",
  completed: "evaluation-completed",
  decision: "human-decision-recorded",
} as const);

export interface EvaluationTimelineEntry {
  readonly eventId: string;
  readonly sequence: number;
  readonly eventType: (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
  readonly occurredAt: string;
  readonly payload: JsonObject;
}

export interface HumanDecisionProjection {
  readonly decisionId: string;
  readonly decision: HumanDecision;
  readonly actor: string;
  readonly note: string | null;
  readonly childEvaluationId: string | null;
  readonly recordedAt: string;
}

export interface EvaluationDetailProjection {
  readonly evaluationId: string;
  readonly scenario: ReleaseScenario;
  readonly candidate: CandidateIdentity;
  readonly parentEvaluationId: string | null;
  readonly createdAt: string;
  readonly outcome: EvaluationOutcome;
  readonly reason: string;
  readonly evidence: readonly EvidenceObservation[];
  readonly toolCalls: readonly ToolCallReceipt[];
  readonly allowedHumanDecisions: readonly HumanDecision[];
  readonly decision: HumanDecisionProjection | null;
  readonly attentionRequired: boolean;
  readonly externalMutations: 0;
  readonly timeline: readonly EvaluationTimelineEntry[];
}

export interface InboxItemProjection {
  readonly evaluationId: string;
  readonly repository: string;
  readonly branch: string;
  readonly commit: string;
  readonly createdAt: string;
  readonly outcome: EvaluationOutcome;
  readonly attentionRequired: boolean;
  readonly decision: HumanDecision | null;
  readonly parentEvaluationId: string | null;
}

export interface DecisionCommand {
  readonly evaluationId: string;
  readonly decision: HumanDecision;
  readonly actor: string;
  readonly note?: string;
  readonly idempotencyKey: string;
}

export interface DecisionCommandResult {
  readonly evaluationId: string;
  readonly decisionEventId: string;
  readonly decision: HumanDecision;
  readonly childEvaluationId: string | null;
  readonly replayed: boolean;
}

export interface EvaluationServiceOptions {
  readonly clock?: () => Date;
  readonly idFactory?: (kind: "evaluation" | "event" | "decision") => string;
  readonly runScenario?: (
    fixture: ReleaseFixture,
  ) => Promise<ReleaseSliceResult>;
  readonly runLiveGitHubSourceCi?: () => Promise<LiveGitHubSourceCiSliceResult>;
}

export class EvaluationNotFoundError extends Error {
  readonly code = "EVALUATION_NOT_FOUND" as const;

  constructor(evaluationId: string) {
    super(`Evaluation ${evaluationId} was not found.`);
    this.name = "EvaluationNotFoundError";
  }
}

export class DecisionNotAllowedError extends Error {
  readonly code = "DECISION_NOT_ALLOWED" as const;

  constructor(evaluationId: string, decision: HumanDecision) {
    super(
      `Decision ${decision} is not allowed for evaluation ${evaluationId}.`,
    );
    this.name = "DecisionNotAllowedError";
  }
}

export class EvaluationAlreadyResolvedError extends Error {
  readonly code = "EVALUATION_ALREADY_RESOLVED" as const;

  constructor(evaluationId: string) {
    super(`Evaluation ${evaluationId} already has a human decision.`);
    this.name = "EvaluationAlreadyResolvedError";
  }
}

export class StoredEvaluationInvariantError extends Error {
  readonly code = "STORED_EVALUATION_INVARIANT_FAILED" as const;

  constructor(reason: string) {
    super(`Stored evaluation invariant failed: ${reason}`);
    this.name = "StoredEvaluationInvariantError";
  }
}

export class EvaluationService {
  readonly #ledger: SQLiteEvaluationLedger;
  readonly #clock: () => Date;
  readonly #idFactory: (kind: "evaluation" | "event" | "decision") => string;
  readonly #runScenario: (
    fixture: ReleaseFixture,
  ) => Promise<ReleaseSliceResult>;
  readonly #runLiveGitHubSourceCi: () => Promise<LiveGitHubSourceCiSliceResult>;

  constructor(
    ledger: SQLiteEvaluationLedger,
    options: EvaluationServiceOptions = {},
  ) {
    this.#ledger = ledger;
    this.#clock = options.clock ?? (() => new Date());
    this.#idFactory =
      options.idFactory ?? ((kind) => `${kind}_${randomUUID()}`);
    this.#runScenario =
      options.runScenario ?? ((fixture) => runReleaseSlice(fixture));
    this.#runLiveGitHubSourceCi =
      options.runLiveGitHubSourceCi ?? runLiveGitHubSourceCiSlice;
  }

  async startDemoEvaluation(
    scenario: FixtureReleaseScenario,
  ): Promise<EvaluationDetailProjection> {
    const [evaluation] = await this.startDemoEvaluations([scenario]);
    if (!evaluation) {
      throw new Error("Demo evaluation batch did not return its evaluation.");
    }
    return evaluation;
  }

  async startDemoEvaluations(
    scenarios: readonly FixtureReleaseScenario[],
  ): Promise<readonly EvaluationDetailProjection[]> {
    if (scenarios.length === 0) {
      throw new Error("At least one demo evaluation scenario is required.");
    }

    const created = [];
    for (const scenario of scenarios) {
      created.push(await this.#buildDemoEvaluation(scenario, null));
    }
    this.#ledger.commit({
      evaluations: created.map((item) => item.evaluation),
      events: created.flatMap((item) => item.events),
    });
    return Object.freeze(
      created.map((item) => this.getEvaluation(item.evaluation.evaluationId)),
    );
  }

  async startLiveGitHubSourceCiEvaluation(): Promise<EvaluationDetailProjection> {
    const created = await this.#buildLiveGitHubSourceCiEvaluation();
    this.#ledger.commit({
      evaluations: [created.evaluation],
      events: created.events,
    });
    return this.getEvaluation(created.evaluation.evaluationId);
  }

  async recordDecision(
    command: DecisionCommand,
  ): Promise<DecisionCommandResult> {
    const normalized = normalizeDecisionCommand(command);
    const scope = `decision:${normalized.evaluationId}`;
    const request = decisionRequest(normalized);
    const existing = this.#ledger.findIdempotency(
      scope,
      normalized.idempotencyKey,
      request,
    );

    if (existing.found) {
      return parseDecisionResponse(existing.response, true);
    }

    const current = this.getEvaluation(normalized.evaluationId);
    if (current.decision) {
      throw new EvaluationAlreadyResolvedError(normalized.evaluationId);
    }
    if (!current.allowedHumanDecisions.includes(normalized.decision)) {
      throw new DecisionNotAllowedError(
        normalized.evaluationId,
        normalized.decision,
      );
    }

    const occurredAt = this.#now();
    const decisionEventId = this.#idFactory("event");
    const decisionId = this.#idFactory("decision");
    const child =
      normalized.decision === "Re-check requested"
        ? await this.#buildDemoEvaluation(
            "deployed-sha-mismatch",
            normalized.evaluationId,
          )
        : undefined;
    const childEvaluationId = child?.evaluation.evaluationId ?? null;
    const response = Object.freeze({
      evaluationId: normalized.evaluationId,
      decisionEventId,
      decision: normalized.decision,
      childEvaluationId,
    }) satisfies JsonObject;
    const parentDecisionEvent: NewLedgerEvent = Object.freeze({
      eventId: decisionEventId,
      evaluationId: normalized.evaluationId,
      sequence: current.timeline.length + 1,
      eventType: EVENT_TYPES.decision,
      occurredAt,
      payload: Object.freeze({
        decisionId,
        decision: normalized.decision,
        actor: normalized.actor,
        note: normalized.note,
        childEvaluationId,
        idempotencyKey: normalized.idempotencyKey,
      }),
    });

    const commit = this.#ledger.commit({
      ...(child ? { evaluations: [child.evaluation] } : {}),
      events: [parentDecisionEvent, ...(child?.events ?? [])],
      idempotency: {
        scope,
        key: normalized.idempotencyKey,
        request,
        response,
        createdAt: occurredAt,
      },
    });

    return parseDecisionResponse(commit.response ?? response, commit.replayed);
  }

  getEvaluation(evaluationId: string): EvaluationDetailProjection {
    const record = this.#ledger.getEvaluation(evaluationId);
    if (!record) throw new EvaluationNotFoundError(evaluationId);
    return projectEvaluation(record, this.#ledger.listEvents(evaluationId));
  }

  listInbox(): readonly InboxItemProjection[] {
    const items = this.#ledger.listEvaluations().map((record) => {
      const detail = projectEvaluation(
        record,
        this.#ledger.listEvents(record.evaluationId),
      );
      return Object.freeze({
        evaluationId: detail.evaluationId,
        repository: detail.candidate.repository,
        branch: detail.candidate.branch,
        commit: detail.candidate.commit,
        createdAt: detail.createdAt,
        outcome: detail.outcome,
        attentionRequired: detail.attentionRequired,
        decision: detail.decision?.decision ?? null,
        parentEvaluationId: detail.parentEvaluationId,
      });
    });

    return Object.freeze(
      items.sort(
        (left, right) =>
          Number(right.attentionRequired) - Number(left.attentionRequired) ||
          right.createdAt.localeCompare(left.createdAt) ||
          right.evaluationId.localeCompare(left.evaluationId),
      ),
    );
  }

  #now(): string {
    const value = this.#clock();
    if (Number.isNaN(value.getTime())) {
      throw new Error("Evaluation clock returned an invalid date.");
    }
    return value.toISOString();
  }

  async #buildDemoEvaluation(
    scenario: FixtureReleaseScenario,
    parentEvaluationId: string | null,
  ): Promise<{
    readonly evaluation: NewEvaluationRecord;
    readonly events: readonly NewLedgerEvent[];
  }> {
    const fixture = fixtureForScenario(scenario);
    const result = await this.#runScenario(fixture);
    requireResultMatchesScenario(result, scenario);
    return this.#buildEvaluationEvents(
      scenario,
      demoCandidate(fixture.expectedCommit),
      result,
      parentEvaluationId,
    );
  }

  async #buildLiveGitHubSourceCiEvaluation(): Promise<{
    readonly evaluation: NewEvaluationRecord;
    readonly events: readonly NewLedgerEvent[];
  }> {
    const result = await this.#runLiveGitHubSourceCi();
    requireResultMatchesScenario(result, "live-github-source-ci");
    return this.#buildEvaluationEvents(
      "live-github-source-ci",
      liveGitHubCandidate(result),
      result,
      null,
    );
  }

  #buildEvaluationEvents(
    scenario: ReleaseScenario,
    candidate: CandidateIdentity,
    result: ReleaseSliceResult,
    parentEvaluationId: string | null,
  ): {
    readonly evaluation: NewEvaluationRecord;
    readonly events: readonly NewLedgerEvent[];
  } {
    const evaluationId = this.#idFactory("evaluation");
    const createdAt = this.#now();
    const evaluation: NewEvaluationRecord = Object.freeze({
      evaluationId,
      scenario,
      candidate: candidateJson(candidate),
      parentEvaluationId,
      createdAt,
    });
    const payloads: readonly {
      readonly eventType: NewLedgerEvent["eventType"];
      readonly payload: JsonObject;
    }[] = [
      {
        eventType: EVENT_TYPES.started,
        payload: Object.freeze({ scenario, parentEvaluationId }),
      },
      ...result.observations.map((observation) => ({
        eventType: EVENT_TYPES.evidence,
        payload: Object.freeze({
          evidenceId: observation.evidenceId,
          kind: observation.kind,
          status: observation.status,
          value: observation.value,
        }),
      })),
      {
        eventType: EVENT_TYPES.policy,
        payload: Object.freeze({
          outcome: result.policy.outcome,
          reason: result.policy.reason,
          evidenceIds: Object.freeze([...result.policy.evidenceIds]),
          allowedHumanDecisions: Object.freeze([
            ...result.policy.allowedHumanDecisions,
          ]),
        }),
      },
      {
        eventType: EVENT_TYPES.completed,
        payload: Object.freeze({
          agentRuntime: result.agentRuntime,
          agentRuntimeVersion: result.agentRuntimeVersion,
          modelMode: result.modelMode,
          toolCalls: Object.freeze(
            result.toolCalls.map((call) => toolCallJson(call)),
          ),
          externalMutations: result.externalMutations,
        }),
      },
    ];
    const events = Object.freeze(
      payloads.map((item, index) =>
        Object.freeze({
          eventId: this.#idFactory("event"),
          evaluationId,
          sequence: index + 1,
          eventType: item.eventType,
          occurredAt: createdAt,
          payload: item.payload,
        }),
      ),
    );

    return Object.freeze({ evaluation, events });
  }
}

function fixtureForScenario(scenario: FixtureReleaseScenario): ReleaseFixture {
  switch (scenario) {
    case "ready":
      return READY_FIXTURE;
    case "deployed-sha-mismatch":
      return MISMATCH_FIXTURE;
  }
}

function liveGitHubCandidate(
  result: LiveGitHubSourceCiSliceResult,
): CandidateIdentity {
  return parseCandidateIdentity({
    schemaVersion: "1",
    repository: result.candidate.repository,
    branch: result.candidate.branch,
    commit: result.candidate.commit,
    deploymentUrl: LIVE_GITHUB_INCOMPLETE_DEPLOYMENT_URL,
  });
}

function demoCandidate(commit: string): CandidateIdentity {
  return parseCandidateIdentity({
    schemaVersion: "1",
    repository: DEMO_REPOSITORY,
    branch: DEMO_BRANCH,
    commit,
    deploymentUrl: DEMO_DEPLOYMENT_URL,
  });
}

function candidateJson(candidate: CandidateIdentity): JsonObject {
  return Object.freeze({
    schemaVersion: candidate.schemaVersion,
    repository: candidate.repository,
    branch: candidate.branch,
    commit: candidate.commit,
    deploymentUrl: candidate.deploymentUrl,
  });
}

function toolCallJson(call: ToolCallReceipt): JsonObject {
  return Object.freeze({
    toolName: call.toolName,
    evidenceId: call.evidenceId,
    ...(call.provider ? { provider: call.provider } : {}),
    ...(call.providerRecordId
      ? { providerRecordId: call.providerRecordId }
      : {}),
    ...(call.sourceUrl ? { sourceUrl: call.sourceUrl } : {}),
    ...(call.fetchedAt ? { fetchedAt: call.fetchedAt } : {}),
    externalMutations: call.externalMutations,
  });
}

function evidenceKindsForScenario(
  scenario: ReleaseScenario,
): readonly EvidenceKind[] {
  return scenario === "live-github-source-ci"
    ? Object.freeze([EVIDENCE_KINDS[0], EVIDENCE_KINDS[1]])
    : EVIDENCE_KINDS;
}

function toolNamesForScenario(scenario: ReleaseScenario): readonly string[] {
  return scenario === "live-github-source-ci"
    ? LIVE_GITHUB_EVIDENCE_TOOL_NAMES
    : EVIDENCE_TOOL_NAMES;
}

function requireResultMatchesScenario(
  result: ReleaseSliceResult,
  scenario: ReleaseScenario,
): void {
  const expectedEvidenceKinds = evidenceKindsForScenario(scenario);
  const expectedToolNames = toolNamesForScenario(scenario);
  if (result.scenario !== scenario) {
    throw new StoredEvaluationInvariantError(
      `runner returned ${result.scenario} for ${scenario}`,
    );
  }
  if (
    result.observations.length !== expectedEvidenceKinds.length ||
    !result.observations.every(
      (observation, index) =>
        observation.kind === expectedEvidenceKinds[index] &&
        observation.status === "Verified",
    )
  ) {
    throw new StoredEvaluationInvariantError(
      `runner returned unexpected evidence for ${scenario}`,
    );
  }
  if (
    JSON.stringify(result.policy.evidenceIds) !==
      JSON.stringify(
        result.observations.map((observation) => observation.evidenceId),
      ) ||
    JSON.stringify(result.toolCalls.map((call) => call.toolName)) !==
      JSON.stringify(expectedToolNames) ||
    JSON.stringify(result.toolCalls.map((call) => call.evidenceId)) !==
      JSON.stringify(
        result.observations.map((observation) => observation.evidenceId),
      ) ||
    result.externalMutations !== 0 ||
    result.toolCalls.some((call) => call.externalMutations !== 0) ||
    (scenario === "live-github-source-ci" &&
      !result.toolCalls.every(isBoundLiveGitHubReceipt))
  ) {
    throw new StoredEvaluationInvariantError(
      `runner receipts do not match evidence for ${scenario}`,
    );
  }
  if (
    (scenario === "ready" &&
      (result.policy.outcome !== "Ready" ||
        result.policy.allowedHumanDecisions.length !== 0)) ||
    (scenario === "deployed-sha-mismatch" &&
      (result.policy.outcome !== "Needs decision" ||
        JSON.stringify(result.policy.allowedHumanDecisions) !==
          JSON.stringify(["Reject", "Re-check requested"]))) ||
    (scenario === "live-github-source-ci" &&
      (result.policy.outcome !== "Could not complete" ||
        result.policy.allowedHumanDecisions.length !== 0))
  ) {
    throw new StoredEvaluationInvariantError(
      `runner policy does not match ${scenario}`,
    );
  }
}

function projectEvaluation(
  record: StoredEvaluationRecord,
  storedEvents: readonly StoredLedgerEvent[],
): EvaluationDetailProjection {
  const scenario = parseScenario(record.scenario);
  const candidate = parseCandidateIdentity(record.candidate);
  const expectedEvidenceKinds = evidenceKindsForScenario(scenario);
  const expectedToolNames = toolNamesForScenario(scenario);
  const timeline = Object.freeze(storedEvents.map(projectTimelineEntry));
  timeline.forEach((event, index) => {
    if (event.sequence !== index + 1) {
      throw new StoredEvaluationInvariantError(
        `evaluation ${record.evaluationId} has a non-contiguous timeline`,
      );
    }
  });
  const evidence = Object.freeze(
    eventsOfType(timeline, EVENT_TYPES.evidence).map((event) =>
      parseEvidence(event.payload),
    ),
  );
  if (evidence.length !== expectedEvidenceKinds.length) {
    throw new StoredEvaluationInvariantError(
      `evaluation ${record.evaluationId} must have exactly ${expectedEvidenceKinds.length} evidence events`,
    );
  }
  if (
    !evidence.every(
      (observation, index) => observation.kind === expectedEvidenceKinds[index],
    )
  ) {
    throw new StoredEvaluationInvariantError(
      `evaluation ${record.evaluationId} has unexpected evidence ordering`,
    );
  }

  const policy = exactlyOneEvent(timeline, EVENT_TYPES.policy);
  const completed = exactlyOneEvent(timeline, EVENT_TYPES.completed);
  const started = exactlyOneEvent(timeline, EVENT_TYPES.started);
  if (
    readString(started.payload, "scenario") !== scenario ||
    readNullableString(started.payload, "parentEvaluationId") !==
      record.parentEvaluationId
  ) {
    throw new StoredEvaluationInvariantError(
      `evaluation ${record.evaluationId} start event does not match its record`,
    );
  }
  const decisionEvents = eventsOfType(timeline, EVENT_TYPES.decision);
  if (decisionEvents.length > 1) {
    throw new StoredEvaluationInvariantError(
      `evaluation ${record.evaluationId} has multiple human decisions`,
    );
  }

  const outcome = parseEvaluationOutcome(readString(policy.payload, "outcome"));
  const reason = readString(policy.payload, "reason");
  const allowedHumanDecisions = Object.freeze(
    readStringArray(policy.payload, "allowedHumanDecisions").map(
      parseHumanDecision,
    ),
  );
  const policyEvidenceIds = readStringArray(policy.payload, "evidenceIds");
  if (
    JSON.stringify(policyEvidenceIds) !==
    JSON.stringify(evidence.map((observation) => observation.evidenceId))
  ) {
    throw new StoredEvaluationInvariantError(
      `evaluation ${record.evaluationId} policy evidence does not match stored evidence`,
    );
  }
  const toolCalls = parseToolCalls(completed.payload);
  if (
    JSON.stringify(toolCalls.map((call) => call.toolName)) !==
      JSON.stringify(expectedToolNames) ||
    JSON.stringify(toolCalls.map((call) => call.evidenceId)) !==
      JSON.stringify(evidence.map((observation) => observation.evidenceId))
  ) {
    throw new StoredEvaluationInvariantError(
      `evaluation ${record.evaluationId} tool receipts do not match stored evidence`,
    );
  }
  const externalMutations = readZero(completed.payload, "externalMutations");
  const decision = decisionEvents[0] ? parseDecision(decisionEvents[0]) : null;
  if (decision && !allowedHumanDecisions.includes(decision.decision)) {
    throw new StoredEvaluationInvariantError(
      `evaluation ${record.evaluationId} contains a decision not allowed by policy`,
    );
  }
  if (
    (scenario === "ready" &&
      (outcome !== "Ready" || allowedHumanDecisions.length !== 0)) ||
    (scenario === "deployed-sha-mismatch" &&
      (outcome !== "Needs decision" ||
        JSON.stringify(allowedHumanDecisions) !==
          JSON.stringify(["Reject", "Re-check requested"]))) ||
    (scenario === "live-github-source-ci" &&
      (outcome !== "Could not complete" ||
        allowedHumanDecisions.length !== 0 ||
        candidate.commit !== evidence[0]?.value ||
        !toolCalls.every(isBoundLiveGitHubReceipt)))
  ) {
    throw new StoredEvaluationInvariantError(
      `evaluation ${record.evaluationId} outcome does not match its demo scenario`,
    );
  }
  const attentionRequired = outcome === "Needs decision" && decision === null;

  return Object.freeze({
    evaluationId: record.evaluationId,
    scenario,
    candidate,
    parentEvaluationId: record.parentEvaluationId,
    createdAt: record.createdAt,
    outcome,
    reason,
    evidence,
    toolCalls,
    allowedHumanDecisions,
    decision,
    attentionRequired,
    externalMutations,
    timeline,
  });
}

function projectTimelineEntry(
  event: StoredLedgerEvent,
): EvaluationTimelineEntry {
  if (!Object.values(EVENT_TYPES).includes(event.eventType as never)) {
    throw new StoredEvaluationInvariantError(
      `unknown event type ${event.eventType}`,
    );
  }

  return Object.freeze({
    eventId: event.eventId,
    sequence: event.sequence,
    eventType: event.eventType as EvaluationTimelineEntry["eventType"],
    occurredAt: event.occurredAt,
    payload: event.payload,
  });
}

function parseEvidence(payload: JsonObject): EvidenceObservation {
  const kind = readString(payload, "kind");
  if (!(EVIDENCE_KINDS as readonly string[]).includes(kind)) {
    throw new StoredEvaluationInvariantError(`unknown evidence kind ${kind}`);
  }
  if (readString(payload, "status") !== "Verified") {
    throw new StoredEvaluationInvariantError("stored evidence is not Verified");
  }

  return Object.freeze({
    evidenceId: readString(payload, "evidenceId"),
    kind: kind as EvidenceKind,
    status: "Verified",
    value: readString(payload, "value"),
  });
}

function parseToolCalls(payload: JsonObject): readonly ToolCallReceipt[] {
  const value = payload.toolCalls;
  if (!Array.isArray(value)) {
    throw new StoredEvaluationInvariantError("toolCalls must be an array");
  }

  return Object.freeze(
    value.map((item) => {
      const record = readObject(item, "tool call");
      const provider = readOptionalString(record, "provider");
      if (provider !== undefined && provider !== "github") {
        throw new StoredEvaluationInvariantError(
          `unknown tool receipt provider ${provider}`,
        );
      }
      const providerRecordId = readOptionalString(record, "providerRecordId");
      const sourceUrl = readOptionalString(record, "sourceUrl");
      const fetchedAt = readOptionalString(record, "fetchedAt");
      return Object.freeze({
        toolName: readString(record, "toolName") as ToolCallReceipt["toolName"],
        evidenceId: readString(record, "evidenceId"),
        ...(provider ? { provider } : {}),
        ...(providerRecordId ? { providerRecordId } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(fetchedAt ? { fetchedAt } : {}),
        externalMutations: readZero(record, "externalMutations"),
      });
    }),
  );
}

function parseDecision(
  event: EvaluationTimelineEntry,
): HumanDecisionProjection {
  return Object.freeze({
    decisionId: readString(event.payload, "decisionId"),
    decision: parseHumanDecision(readString(event.payload, "decision")),
    actor: readString(event.payload, "actor"),
    note: readNullableString(event.payload, "note"),
    childEvaluationId: readNullableString(event.payload, "childEvaluationId"),
    recordedAt: event.occurredAt,
  });
}

function parseScenario(value: string): ReleaseScenario {
  if (
    value === "ready" ||
    value === "deployed-sha-mismatch" ||
    value === "live-github-source-ci"
  )
    return value;
  throw new StoredEvaluationInvariantError(`unknown scenario ${value}`);
}

function exactlyOneEvent(
  events: readonly EvaluationTimelineEntry[],
  eventType: EvaluationTimelineEntry["eventType"],
): EvaluationTimelineEntry {
  const matches = eventsOfType(events, eventType);
  if (matches.length !== 1) {
    throw new StoredEvaluationInvariantError(
      `expected exactly one ${eventType} event`,
    );
  }
  return matches[0]!;
}

function eventsOfType(
  events: readonly EvaluationTimelineEntry[],
  eventType: EvaluationTimelineEntry["eventType"],
): readonly EvaluationTimelineEntry[] {
  return events.filter((event) => event.eventType === eventType);
}

function normalizeDecisionCommand(
  command: DecisionCommand,
): Required<Omit<DecisionCommand, "note">> & { readonly note: string | null } {
  const evaluationId = requireBoundedText(
    command.evaluationId,
    "evaluationId",
    200,
  );
  const actor = requireBoundedText(command.actor, "actor", 120);
  const idempotencyKey = requireBoundedText(
    command.idempotencyKey,
    "idempotencyKey",
    200,
  );
  const note = command.note?.trim() || null;
  if (note && note.length > 500) {
    throw new Error("note must be at most 500 characters.");
  }

  return Object.freeze({
    evaluationId,
    decision: parseHumanDecision(command.decision),
    actor,
    note,
    idempotencyKey,
  });
}

function decisionRequest(
  command: ReturnType<typeof normalizeDecisionCommand>,
): JsonObject {
  return Object.freeze({
    evaluationId: command.evaluationId,
    decision: command.decision,
    actor: command.actor,
    note: command.note,
  });
}

function parseDecisionResponse(
  response: JsonObject,
  replayed: boolean,
): DecisionCommandResult {
  return Object.freeze({
    evaluationId: readString(response, "evaluationId"),
    decisionEventId: readString(response, "decisionEventId"),
    decision: parseHumanDecision(readString(response, "decision")),
    childEvaluationId: readNullableString(response, "childEvaluationId"),
    replayed,
  });
}

function requireBoundedText(
  value: string,
  label: string,
  maximum: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function readObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StoredEvaluationInvariantError(`${label} must be an object`);
  }
  return value as JsonObject;
}

function readString(record: JsonObject, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new StoredEvaluationInvariantError(`${key} must be a string`);
  }
  return value;
}

function readNullableString(record: JsonObject, key: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new StoredEvaluationInvariantError(`${key} must be a string or null`);
  }
  return value;
}

function readOptionalString(
  record: JsonObject,
  key: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new StoredEvaluationInvariantError(`${key} must be a string`);
  }
  return value;
}

function isBoundLiveGitHubReceipt(call: ToolCallReceipt): boolean {
  if (
    call.provider !== "github" ||
    !call.providerRecordId ||
    !call.sourceUrl ||
    !call.fetchedAt ||
    Number.isNaN(Date.parse(call.fetchedAt)) ||
    call.externalMutations !== 0
  ) {
    return false;
  }
  try {
    return new URL(call.sourceUrl).origin === "https://github.com";
  } catch {
    return false;
  }
}

function readStringArray(record: JsonObject, key: string): readonly string[] {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new StoredEvaluationInvariantError(
      `${key} must be an array of strings`,
    );
  }
  return value;
}

function readZero(record: JsonObject, key: string): 0 {
  if (record[key] !== 0) {
    throw new StoredEvaluationInvariantError(`${key} must be zero`);
  }
  return 0;
}
