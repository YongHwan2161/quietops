import {
  parseDecisionEnvelope,
  resolvePolicyProfile,
} from "@quietops/contracts";
import {
  SQLiteReleaseRunLedger,
  type JsonObject,
  type NewReleaseRunEvent,
} from "@quietops/storage";

const CANDIDATE = "febafb3745bb5fd0ab2039be0fb3c540b46abcb3";
const PREVIOUS_DEPLOYMENT = "26875fb2f1eff59fef7d8fbf5b02d5c5dd505b72";
const CI_RUN_ID = "32720816153";
const MARKER_URL =
  "https://quietops-production.up.railway.app/.well-known/quietops-release.json";
const HOMEPAGE_URL = "https://quietops-production.up.railway.app/";

export interface SeedReleaseDemoRunsOptions {
  readonly evidenceMode?: "preserved-demo" | "live";
}

export function seedReleaseDemoRuns(
  ledger: SQLiteReleaseRunLedger,
  options: SeedReleaseDemoRunsOptions = {},
): readonly string[] {
  const evidenceMode = options.evidenceMode ?? "preserved-demo";
  const runIds = [
    seedQuietCompletion(ledger, evidenceMode),
    seedDecisionBoundary(ledger, evidenceMode),
  ];
  return Object.freeze(runIds);
}

function seedQuietCompletion(
  ledger: SQLiteReleaseRunLedger,
  evidenceMode: "preserved-demo" | "live",
): string {
  const prefix =
    evidenceMode === "preserved-demo" ? "preserved" : "browser-live";
  const runId = `${prefix}-quiet-release`;
  const createdAt = "2026-08-24T11:15:00.000Z";
  const created = ledger.createRunFromWebhook({
    runId,
    triggerEventId: "preserved-quiet-trigger",
    repository: "YongHwan2161/quietops",
    branch: "main",
    candidateCommit: CANDIDATE,
    triggerDeliveryId:
      evidenceMode === "preserved-demo"
        ? "preserved-demo:quiet-release"
        : "browser-test:quiet-release",
    policyProfile: resolvePolicyProfile("demo-v1"),
    createdAt,
  });
  if (created.replayed) return runId;

  const occurredAt = "2026-08-24T11:15:02.000Z";
  ledger.appendTransition({
    runId,
    expectedVersion: 1,
    events: [
      observationEvent({
        eventId: "preserved-quiet-observation",
        sequence: 2,
        occurredAt,
        phase: "FIRST_OBSERVATION",
        deployedCommit: CANDIDATE,
        includeSourceAndCi: true,
        includeRecheck: false,
      }),
      {
        eventId: "preserved-quiet-completed",
        sequence: 3,
        eventType: "run-completed",
        occurredAt,
        payload: transitionPayload("CANDIDATE_READY", null, null),
      },
    ],
    nextHead: {
      state: "COMPLETED",
      nextWakeAt: null,
      activeDecisionId: null,
      updatedAt: occurredAt,
    },
  });
  return runId;
}

function seedDecisionBoundary(
  ledger: SQLiteReleaseRunLedger,
  evidenceMode: "preserved-demo" | "live",
): string {
  const prefix =
    evidenceMode === "preserved-demo" ? "preserved" : "browser-live";
  const runId = `${prefix}-delayed-release`;
  const decisionId = `${prefix}-release-decision`;
  const createdAt = "2026-08-24T11:16:00.000Z";
  const firstObservedAt = "2026-08-24T11:16:02.000Z";
  const wakeAt = "2026-08-24T11:16:07.000Z";
  const decisionAt = "2026-08-24T11:16:08.000Z";
  const expiresAt = "2026-08-24T11:31:08.000Z";
  const policyProfile = resolvePolicyProfile("demo-v1");
  const created = ledger.createRunFromWebhook({
    runId,
    triggerEventId: "preserved-delayed-trigger",
    repository: "YongHwan2161/quietops",
    branch: "main",
    candidateCommit: CANDIDATE,
    triggerDeliveryId:
      evidenceMode === "preserved-demo"
        ? "preserved-demo:delayed-release"
        : "browser-test:delayed-release",
    policyProfile,
    createdAt,
  });
  if (created.replayed) return runId;

  const sourceEvidenceId = `github-commit:${CANDIDATE}`;
  const ciEvidenceId = `github-actions-run:${CI_RUN_ID}`;
  const deploymentEvidenceId = `deployment-marker:${PREVIOUS_DEPLOYMENT}`;
  const smokeEvidenceId = `homepage-smoke:quietops-production.up.railway.app:${decisionAt}`;
  const envelope = parseDecisionEnvelope({
    decisionId,
    runId,
    candidateCommit: CANDIDATE,
    expectedRunVersion: 6,
    evidence: {
      source: { evidenceId: sourceEvidenceId, fetchedAt: firstObservedAt },
      ci: { evidenceId: ciEvidenceId, fetchedAt: firstObservedAt },
      deployment: { evidenceId: deploymentEvidenceId, fetchedAt: decisionAt },
      homepageSmoke: { evidenceId: smokeEvidenceId, fetchedAt: decisionAt },
    },
    observationCount: 2,
    waitCount: 1,
    elapsedMs: 8_000,
    missingContext:
      "Required CI passed and the current release is healthy, but the candidate is still not deployed after the safe observation budget. Only the owner knows whether this rollout delay is expected.",
    choices: [
      {
        choice: "WAIT_AND_RECHECK",
        summary:
          "Authorize one final five-second wait and one deployment/homepage observation on this same run.",
      },
      {
        choice: "ESCALATE_INCIDENT",
        summary:
          "Authorize one evidence-linked GitHub incident attempt with no automatic retry.",
      },
    ],
    createdAt: decisionAt,
    expiresAt,
    policyProfile,
    idempotencyScope: `release-decision:${decisionId}`,
  });
  const events: readonly NewReleaseRunEvent[] = [
    observationEvent({
      eventId: "preserved-delayed-observation-1",
      sequence: 2,
      occurredAt: firstObservedAt,
      phase: "FIRST_OBSERVATION",
      deployedCommit: PREVIOUS_DEPLOYMENT,
      includeSourceAndCi: true,
      includeRecheck: true,
    }),
    {
      eventId: "preserved-delayed-wait",
      sequence: 3,
      eventType: "wait-scheduled",
      occurredAt: firstObservedAt,
      payload: transitionPayload("NORMAL_WAIT_REQUIRED", wakeAt, null),
    },
    {
      eventId: "preserved-delayed-woke",
      sequence: 4,
      eventType: "run-woke",
      occurredAt: wakeAt,
      payload: transitionPayload("WAIT_DUE", null, null),
    },
    observationEvent({
      eventId: "preserved-delayed-observation-2",
      sequence: 5,
      occurredAt: decisionAt,
      phase: "LATER_OBSERVATION",
      deployedCommit: PREVIOUS_DEPLOYMENT,
      includeSourceAndCi: false,
      includeRecheck: true,
    }),
    {
      eventId: "preserved-delayed-decision",
      sequence: 6,
      eventType: "decision-requested",
      occurredAt: decisionAt,
      payload: {
        ...transitionPayload(
          "OBSERVATION_BUDGET_EXHAUSTED",
          expiresAt,
          decisionId,
        ),
        decisionId,
        decisionEnvelope: JSON.parse(JSON.stringify(envelope)) as JsonObject,
      },
    },
  ];
  ledger.appendTransition({
    runId,
    expectedVersion: 1,
    events,
    nextHead: {
      state: "AWAITING_DECISION",
      nextWakeAt: expiresAt,
      activeDecisionId: decisionId,
      updatedAt: decisionAt,
    },
  });
  return runId;
}

function observationEvent(input: {
  readonly eventId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly phase: "FIRST_OBSERVATION" | "LATER_OBSERVATION";
  readonly deployedCommit: string;
  readonly includeSourceAndCi: boolean;
  readonly includeRecheck: boolean;
}): NewReleaseRunEvent {
  const sourceEvidenceId = `github-commit:${CANDIDATE}`;
  const ciEvidenceId = `github-actions-run:${CI_RUN_ID}`;
  const deploymentEvidenceId = `deployment-marker:${input.deployedCommit}`;
  const smokeEvidenceId = `homepage-smoke:quietops-production.up.railway.app:${input.occurredAt}`;
  const recheckEvidenceId = `recheck:demo-v1:${input.occurredAt}`;
  const evidence: JsonObject[] = [];
  const receipts: JsonObject[] = [];
  if (input.includeSourceAndCi) {
    evidence.push(
      evidenceItem(sourceEvidenceId, "Source revision", CANDIDATE),
      {
        ...evidenceItem(ciEvidenceId, "CI status", "success"),
        headSha: CANDIDATE,
      },
    );
    receipts.push(
      receipt(
        "observe_source_revision",
        sourceEvidenceId,
        "github",
        CANDIDATE,
        `https://github.com/YongHwan2161/quietops/commit/${CANDIDATE}`,
        input.occurredAt,
      ),
      receipt(
        "observe_required_ci",
        ciEvidenceId,
        "github",
        CI_RUN_ID,
        `https://github.com/YongHwan2161/quietops/actions/runs/${CI_RUN_ID}`,
        input.occurredAt,
      ),
    );
  }
  evidence.push(
    evidenceItem(
      deploymentEvidenceId,
      "Deployed revision",
      input.deployedCommit,
    ),
    evidenceItem(smokeEvidenceId, "Homepage smoke", "healthy"),
  );
  receipts.push(
    receipt(
      "observe_deployment_revision",
      deploymentEvidenceId,
      "deployment-marker",
      input.deployedCommit,
      MARKER_URL,
      input.occurredAt,
    ),
    receipt(
      "observe_homepage_smoke",
      smokeEvidenceId,
      "homepage",
      "quietops-production.up.railway.app",
      HOMEPAGE_URL,
      input.occurredAt,
    ),
  );
  if (input.includeRecheck) {
    evidence.push({
      ...evidenceItem(
        recheckEvidenceId,
        "Recheck proposal",
        new Date(Date.parse(input.occurredAt) + 5_000).toISOString(),
      ),
      durationMs: 5_000,
    });
    receipts.push(
      receipt(
        "schedule_recheck",
        recheckEvidenceId,
        "policy-clock",
        "demo-v1@1",
        null,
        input.occurredAt,
      ),
    );
  }
  return {
    eventId: input.eventId,
    sequence: input.sequence,
    eventType: "observation-recorded",
    occurredAt: input.occurredAt,
    payload: {
      cycleId: `preserved-cycle-${input.sequence}`,
      phase: input.phase,
      candidateCommit: CANDIDATE,
      modelMode: "injected-test",
      policySignal:
        input.deployedCommit === CANDIDATE
          ? "CANDIDATE_READY"
          : "NORMAL_WAIT_REQUIRED",
      evidence,
      receipts,
      toolCallCounts: {},
      evidenceCount: evidence.length,
      receiptCount: receipts.length,
      externalMutations: 0,
    },
  };
}

function evidenceItem(
  evidenceId: string,
  kind: string,
  value: string,
): JsonObject {
  return { evidenceId, kind, status: "Verified", value };
}

function receipt(
  toolName: string,
  evidenceId: string,
  provider: string,
  providerRecordId: string,
  sourceUrl: string | null,
  fetchedAt: string,
): JsonObject {
  return {
    toolName,
    evidenceId,
    provider,
    providerRecordId,
    ...(sourceUrl ? { sourceUrl } : {}),
    fetchedAt,
    externalMutations: 0,
  };
}

function transitionPayload(
  signal: string,
  nextWakeAt: string | null,
  activeDecisionId: string | null,
): JsonObject {
  return {
    signal,
    nextWakeAt,
    activeDecisionId,
    stopCode: null,
  };
}
