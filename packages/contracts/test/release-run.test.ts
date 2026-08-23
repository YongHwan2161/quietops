import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALLOWED_RELEASE_TRANSITION_COUNT,
  ContractValidationError,
  DECISION_CHOICES,
  EXTERNAL_ACTION_STATUSES,
  EXTERNAL_ACTION_TYPES,
  FORBIDDEN_RELEASE_TRANSITION_COUNT,
  POLICY_PROFILE_NAMES,
  RELEASE_RUN_SIGNALS,
  RELEASE_RUN_STATES,
  RELEASE_RUN_STOP_CODES,
  RELEASE_TRANSITION_INPUT_COUNT,
  TERMINAL_RELEASE_RUN_STATES,
  isTerminalReleaseRunState,
  parseDecisionChoice,
  parseDecisionEnvelope,
  parseDecisionSubmission,
  parseExternalActionProjection,
  parseExternalActionStatus,
  parseExternalActionType,
  parsePolicyProfile,
  parsePolicyProfileName,
  parseReleaseRunPublicProjection,
  parseReleaseRunSignal,
  parseReleaseRunState,
  parseReleaseRunStopCode,
  planReleaseRunTransition,
  resolvePolicyProfile,
  type ReleaseRunSignal,
  type ReleaseRunState,
  type ReleaseRunStopCode,
} from "../src/index.js";

const COMMIT = "4a390de69a21cfd73ca997cb16766cc4f3dd7e67";
const REQUEST_FINGERPRINT =
  "3b34fdd5f684497414b23488202d068638b9661821e2a5f81ec24f25c8b9c1bd";
const RESPONSE_DIGEST =
  "54bb5d958bdd858e953a4b0a98b7881c7f20c94b7bc31797278b09a0f50b295c";

const VALID_EVIDENCE = {
  source: {
    evidenceId: `source:${COMMIT}`,
    fetchedAt: "2026-08-23T11:00:00.000Z",
  },
  ci: {
    evidenceId: "github-actions:32635689945",
    fetchedAt: "2026-08-23T11:00:01.000Z",
  },
  deployment: {
    evidenceId: `deployment-marker:${COMMIT}`,
    fetchedAt: "2026-08-23T11:00:02.000Z",
  },
  homepageSmoke: {
    evidenceId: `homepage-smoke:${COMMIT}`,
    fetchedAt: "2026-08-23T11:00:03.000Z",
  },
} as const;

const VALID_ENVELOPE = {
  decisionId: "decision-01",
  runId: "run-01",
  candidateCommit: COMMIT,
  expectedRunVersion: 12,
  evidence: VALID_EVIDENCE,
  observationCount: 2,
  waitCount: 1,
  elapsedMs: 5_000,
  missingContext:
    "The previous release is healthy, but only the owner knows whether this delay is expected.",
  choices: [
    {
      choice: "WAIT_AND_RECHECK",
      summary: "Wait once more using the policy-defined extension.",
    },
    {
      choice: "ESCALATE_INCIDENT",
      summary: "Reserve one bounded GitHub incident action.",
    },
  ],
  createdAt: "2026-08-23T11:00:04.000Z",
  expiresAt: "2026-08-23T11:15:04.000Z",
  policyProfile: resolvePolicyProfile("demo-v1"),
  idempotencyScope: "release-decision:decision-01",
} as const;

describe("closed release-run vocabulary", () => {
  it("strictly parses all seven states, both decisions, stop codes, signals, and action vocabularies", () => {
    assert.equal(RELEASE_RUN_STATES.length, 7);
    assert.equal(DECISION_CHOICES.length, 2);
    assert.deepEqual(
      RELEASE_RUN_STATES.map(parseReleaseRunState),
      RELEASE_RUN_STATES,
    );
    assert.deepEqual(
      DECISION_CHOICES.map(parseDecisionChoice),
      DECISION_CHOICES,
    );
    assert.deepEqual(
      RELEASE_RUN_STOP_CODES.map(parseReleaseRunStopCode),
      RELEASE_RUN_STOP_CODES,
    );
    assert.deepEqual(
      RELEASE_RUN_SIGNALS.map(parseReleaseRunSignal),
      RELEASE_RUN_SIGNALS,
    );
    assert.deepEqual(
      EXTERNAL_ACTION_TYPES.map(parseExternalActionType),
      EXTERNAL_ACTION_TYPES,
    );
    assert.deepEqual(
      EXTERNAL_ACTION_STATUSES.map(parseExternalActionStatus),
      EXTERNAL_ACTION_STATUSES,
    );
    assert.deepEqual(
      POLICY_PROFILE_NAMES.map(parsePolicyProfileName),
      POLICY_PROFILE_NAMES,
    );
  });

  it("rejects unknown vocabulary without changing the legacy verifier vocabulary", () => {
    for (const [parser, value] of [
      [parseReleaseRunState, "RUNNING"],
      [parseDecisionChoice, "APPROVE"],
      [parseReleaseRunStopCode, "ASK_HUMAN"],
      [parseReleaseRunSignal, "MODEL_SAYS_GO"],
      [parseExternalActionType, "RUN_COMMAND"],
      [parseExternalActionStatus, "RETRYING"],
      [parsePolicyProfileName, "fast-demo"],
    ] as const) {
      assert.throws(() => parser(value), ContractValidationError);
    }
  });

  it("recognizes only the three terminal states", () => {
    for (const state of RELEASE_RUN_STATES) {
      assert.equal(
        isTerminalReleaseRunState(state),
        TERMINAL_RELEASE_RUN_STATES.includes(
          state as (typeof TERMINAL_RELEASE_RUN_STATES)[number],
        ),
      );
    }
    assert.equal(isTerminalReleaseRunState("TERMINATED"), false);
  });
});

describe("immutable policy profiles", () => {
  it("resolves and strictly round-trips the two named profiles", () => {
    assert.deepEqual(resolvePolicyProfile("demo-v1"), {
      name: "demo-v1",
      version: "1",
      normalDeploymentObservations: 2,
      delayBetweenObservationsMs: 5_000,
      humanDecisionTtlMs: 900_000,
      authorizedExtensionMs: 5_000,
      maxHumanDecisions: 1,
      maxIncidentWriteAttempts: 1,
      providerTimeoutMs: 8_000,
    });
    assert.equal(Object.isFrozen(resolvePolicyProfile("demo-v1")), true);
    for (const name of POLICY_PROFILE_NAMES) {
      assert.deepEqual(
        parsePolicyProfile(resolvePolicyProfile(name)),
        resolvePolicyProfile(name),
      );
    }
  });

  it("rejects renamed, changed, incomplete, and extended profiles", () => {
    const profile = resolvePolicyProfile("standard-v1");
    for (const invalid of [
      { ...profile, name: "standard-v2" },
      { ...profile, delayBetweenObservationsMs: 5_000 },
      { ...profile, maxHumanDecisions: 2 },
      { ...profile, providerTimeoutMs: undefined },
      { ...profile, hiddenOverride: true },
    ]) {
      assert.throws(() => parsePolicyProfile(invalid), ContractValidationError);
    }
  });
});

describe("decision envelope", () => {
  it("accepts one complete, deeply frozen, policy-bound envelope", () => {
    const parsed = parseDecisionEnvelope(VALID_ENVELOPE);
    assert.deepEqual(parsed, VALID_ENVELOPE);
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.evidence), true);
    assert.equal(Object.isFrozen(parsed.choices), true);
  });

  it("accepts only the two-field decision submission", () => {
    assert.deepEqual(
      parseDecisionSubmission({
        choice: "WAIT_AND_RECHECK",
        expectedRunVersion: 12,
      }),
      { choice: "WAIT_AND_RECHECK", expectedRunVersion: 12 },
    );
    assert.throws(
      () =>
        parseDecisionSubmission({
          choice: "ESCALATE_INCIDENT",
          expectedRunVersion: 12,
          actor: "browser-supplied",
        }),
      ContractValidationError,
    );
  });

  it("fails closed on stale-shaped, incomplete, reordered, malformed, or extended envelopes", () => {
    const invalidEnvelopes = [
      { ...VALID_ENVELOPE, expectedRunVersion: 0 },
      { ...VALID_ENVELOPE, expiresAt: VALID_ENVELOPE.createdAt },
      { ...VALID_ENVELOPE, idempotencyScope: "release-decision:other" },
      { ...VALID_ENVELOPE, createdAt: "2026-08-23T11:00:04Z" },
      { ...VALID_ENVELOPE, surprise: true },
      {
        ...VALID_ENVELOPE,
        evidence: {
          ...VALID_EVIDENCE,
          source: { ...VALID_EVIDENCE.source, rawHeaders: {} },
        },
      },
      {
        ...VALID_ENVELOPE,
        choices: [...VALID_ENVELOPE.choices].reverse(),
      },
      {
        ...VALID_ENVELOPE,
        choices: [VALID_ENVELOPE.choices[0]],
      },
    ];
    for (const invalid of invalidEnvelopes) {
      assert.throws(
        () => parseDecisionEnvelope(invalid),
        ContractValidationError,
      );
    }
  });
});

describe("external action contract", () => {
  const reservedAction = {
    actionId: "action-01",
    runId: "run-01",
    actionType: "CREATE_GITHUB_INCIDENT",
    repository: "YongHwan2161/quietops",
    requestFingerprint: REQUEST_FINGERPRINT,
    status: "RESERVED",
    attemptCount: 0,
    providerRecordId: null,
    providerUrl: null,
    responseDigest: null,
    createdAt: "2026-08-23T11:16:00.000Z",
    updatedAt: "2026-08-23T11:16:00.000Z",
  } as const;

  it("accepts reserved and confirmed one-attempt projections", () => {
    assert.deepEqual(
      parseExternalActionProjection(reservedAction),
      reservedAction,
    );
    const confirmed = {
      ...reservedAction,
      status: "CONFIRMED",
      attemptCount: 1,
      providerRecordId: "123",
      providerUrl: "https://github.com/YongHwan2161/quietops/issues/123",
      responseDigest: RESPONSE_DIGEST,
      updatedAt: "2026-08-23T11:16:01.000Z",
    } as const;
    assert.deepEqual(parseExternalActionProjection(confirmed), confirmed);
  });

  it("rejects foreign targets, retries, unknown fields, and inconsistent receipts", () => {
    for (const invalid of [
      { ...reservedAction, repository: "someone/else" },
      { ...reservedAction, attemptCount: 1 },
      { ...reservedAction, status: "IN_FLIGHT", attemptCount: 2 },
      { ...reservedAction, providerRecordId: "partial" },
      { ...reservedAction, token: "secret" },
      {
        ...reservedAction,
        status: "CONFIRMED",
        attemptCount: 1,
        providerRecordId: "not-an-integer",
        providerUrl:
          "https://github.com/YongHwan2161/quietops/issues/not-an-integer",
        responseDigest: RESPONSE_DIGEST,
      },
      {
        ...reservedAction,
        status: "CONFIRMED",
        attemptCount: 1,
        providerRecordId: "123",
        providerUrl: "https://github.com/YongHwan2161/quietops/issues/456",
        responseDigest: RESPONSE_DIGEST,
      },
      {
        ...reservedAction,
        status: "CONFIRMED",
        attemptCount: 1,
        providerRecordId: "123",
        providerUrl: "https://evil.example/issues/123",
        responseDigest: RESPONSE_DIGEST,
      },
    ]) {
      assert.throws(
        () => parseExternalActionProjection(invalid),
        ContractValidationError,
      );
    }
  });

  it("preserves bounded rejected or uncertain response digests without inventing issue identity", () => {
    for (const status of ["REJECTED", "UNCERTAIN"] as const) {
      const projection = {
        ...reservedAction,
        status,
        attemptCount: 1,
        responseDigest: RESPONSE_DIGEST,
        updatedAt: "2026-08-23T11:16:01.000Z",
      } as const;
      assert.deepEqual(parseExternalActionProjection(projection), projection);
    }
  });
});

describe("public projection", () => {
  const projection = {
    runId: "run-01",
    state: "AWAITING_DECISION",
    candidateCommit: COMMIT,
    attentionRequired: true,
    observationCount: 2,
    waitCount: 1,
    humanPromptCount: 1,
    externalWriteAttemptCount: 0,
    stopCode: null,
  } as const;

  it("accepts a bounded attention-first projection", () => {
    assert.deepEqual(parseReleaseRunPublicProjection(projection), projection);
  });

  it("rejects invented attention, missing stop codes, excessive effects, and unknown fields", () => {
    for (const invalid of [
      { ...projection, state: "MONITORING" },
      { ...projection, state: "STOPPED", attentionRequired: false },
      { ...projection, externalWriteAttemptCount: 2 },
      { ...projection, internalLeaseOwner: "worker-1" },
    ]) {
      assert.throws(
        () => parseReleaseRunPublicProjection(invalid),
        ContractValidationError,
      );
    }
  });
});

describe("deterministic transition kernel", () => {
  const allowedTransitions: readonly [
    ReleaseRunState | null,
    ReleaseRunSignal,
    ReleaseRunState,
    ReleaseRunStopCode | null,
    boolean,
    "CREATE_GITHUB_INCIDENT" | null,
  ][] = [
    [null, "TRIGGER_ACCEPTED", "MONITORING", null, false, null],
    [
      "MONITORING",
      "REQUIRED_CI_FAILED",
      "STOPPED",
      "REQUIRED_CI_FAILED",
      false,
      null,
    ],
    [
      "MONITORING",
      "EVIDENCE_INVALID",
      "STOPPED",
      "EVIDENCE_INVALID",
      false,
      null,
    ],
    [
      "MONITORING",
      "EVIDENCE_UNAVAILABLE",
      "STOPPED",
      "EVIDENCE_UNAVAILABLE",
      false,
      null,
    ],
    [
      "MONITORING",
      "DEPLOYMENT_UNHEALTHY",
      "STOPPED",
      "DEPLOYMENT_UNHEALTHY",
      false,
      null,
    ],
    [
      "MONITORING",
      "HOMEPAGE_SMOKE_UNHEALTHY",
      "STOPPED",
      "HOMEPAGE_SMOKE_UNHEALTHY",
      false,
      null,
    ],
    ["MONITORING", "CANDIDATE_READY", "COMPLETED", null, false, null],
    ["MONITORING", "NORMAL_WAIT_REQUIRED", "WAITING", null, false, null],
    [
      "MONITORING",
      "OBSERVATION_BUDGET_EXHAUSTED",
      "AWAITING_DECISION",
      null,
      true,
      null,
    ],
    ["MONITORING", "EXTENSION_READY", "COMPLETED", null, false, null],
    [
      "MONITORING",
      "EXTENSION_EXHAUSTED",
      "STOPPED",
      "EXTENSION_EXHAUSTED",
      false,
      null,
    ],
    ["WAITING", "WAIT_DUE", "MONITORING", null, false, null],
    [
      "AWAITING_DECISION",
      "WAIT_AND_RECHECK_AUTHORIZED",
      "WAITING",
      null,
      false,
      null,
    ],
    [
      "AWAITING_DECISION",
      "ESCALATE_INCIDENT_AUTHORIZED",
      "RESUMING",
      null,
      false,
      "CREATE_GITHUB_INCIDENT",
    ],
    [
      "AWAITING_DECISION",
      "DECISION_EXPIRED",
      "STOPPED",
      "DECISION_EXPIRED",
      false,
      null,
    ],
    ["RESUMING", "ACTION_CONFIRMED", "ESCALATED", null, false, null],
    ["RESUMING", "ACTION_REJECTED", "STOPPED", "ACTION_REJECTED", false, null],
    [
      "RESUMING",
      "ACTION_UNCERTAIN",
      "STOPPED",
      "ACTION_OUTCOME_UNCERTAIN",
      false,
      null,
    ],
    ["MONITORING", "SUPERSEDED", "STOPPED", "SUPERSEDED", false, null],
    ["WAITING", "SUPERSEDED", "STOPPED", "SUPERSEDED", false, null],
    ["AWAITING_DECISION", "SUPERSEDED", "STOPPED", "SUPERSEDED", false, null],
    ["RESUMING", "SUPERSEDED", "STOPPED", "SUPERSEDED", false, null],
  ];

  it("matches every allowed transition exactly", () => {
    assert.equal(ALLOWED_RELEASE_TRANSITION_COUNT, allowedTransitions.length);
    for (const [
      currentState,
      signal,
      nextState,
      stopCode,
      decisionRequest,
      externalAction,
    ] of allowedTransitions) {
      const result = planReleaseRunTransition({ currentState, signal });
      assert.deepEqual(result, {
        allowed: true,
        currentState,
        signal,
        nextState,
        stopCode,
        decisionRequest,
        externalAction,
      });
      assert.equal(Object.isFrozen(result), true);
    }
  });

  it("table-tests every allowed and forbidden state/signal pair", () => {
    let allowed = 0;
    let forbidden = 0;
    for (const currentState of [null, ...RELEASE_RUN_STATES] as const) {
      for (const signal of RELEASE_RUN_SIGNALS) {
        const result = planReleaseRunTransition({ currentState, signal });
        if (result.allowed) {
          allowed += 1;
        } else {
          forbidden += 1;
          assert.equal(result.reason, "FORBIDDEN_TRANSITION");
          assert.equal("decisionRequest" in result, false);
          assert.equal("externalAction" in result, false);
        }
      }
    }
    assert.equal(allowed, ALLOWED_RELEASE_TRANSITION_COUNT);
    assert.equal(forbidden, FORBIDDEN_RELEASE_TRANSITION_COUNT);
    assert.equal(allowed + forbidden, RELEASE_TRANSITION_INPUT_COUNT);
    assert.equal(RELEASE_TRANSITION_INPUT_COUNT, 160);
    assert.equal(allowed, 22);
    assert.equal(forbidden, 138);
  });

  it("keeps all terminal states absorbing", () => {
    for (const state of TERMINAL_RELEASE_RUN_STATES) {
      for (const signal of RELEASE_RUN_SIGNALS) {
        assert.equal(
          planReleaseRunTransition({ currentState: state, signal }).allowed,
          false,
        );
      }
    }
  });

  it("never creates a decision or action from unsafe, stale, or exhausted inputs", () => {
    const unsafeSignals = [
      "REQUIRED_CI_FAILED",
      "DEPLOYMENT_UNHEALTHY",
      "HOMEPAGE_SMOKE_UNHEALTHY",
      "EVIDENCE_UNAVAILABLE",
      "STALE_DECISION",
      "EXTENSION_EXHAUSTED",
    ] as const;
    for (const currentState of [null, ...RELEASE_RUN_STATES] as const) {
      for (const signal of unsafeSignals) {
        const result = planReleaseRunTransition({ currentState, signal });
        if (result.allowed) {
          assert.equal(result.decisionRequest, false);
          assert.equal(result.externalAction, null);
        } else {
          assert.equal("decisionRequest" in result, false);
          assert.equal("externalAction" in result, false);
        }
      }
    }
  });

  it("allows exactly one decision-producing and one action-producing transition", () => {
    const results = [];
    for (const currentState of [null, ...RELEASE_RUN_STATES] as const) {
      for (const signal of RELEASE_RUN_SIGNALS) {
        const result = planReleaseRunTransition({ currentState, signal });
        if (result.allowed) results.push(result);
      }
    }
    assert.deepEqual(
      results
        .filter((result) => result.decisionRequest)
        .map((result) => result.signal),
      ["OBSERVATION_BUDGET_EXHAUSTED"],
    );
    assert.deepEqual(
      results
        .filter((result) => result.externalAction !== null)
        .map((result) => result.signal),
      ["ESCALATE_INCIDENT_AUTHORIZED"],
    );
  });

  it("rejects unknown request fields, states, signals, and model narration", () => {
    for (const invalid of [
      {
        currentState: "MONITORING",
        signal: "CANDIDATE_READY",
        narration: "looks good",
      },
      { currentState: "RUNNING", signal: "CANDIDATE_READY" },
      { currentState: "MONITORING", signal: "MODEL_SAYS_GO" },
      { currentState: "MONITORING" },
      null,
    ]) {
      assert.throws(
        () => planReleaseRunTransition(invalid),
        ContractValidationError,
      );
    }
  });
});
