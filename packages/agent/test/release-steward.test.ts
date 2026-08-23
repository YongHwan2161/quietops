import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  DeploymentEvidenceBundle,
  GitHubEvidenceBundle,
  HomepageSmokeBundle,
} from "@quietops/adapters";

import {
  RELEASE_STEWARD_TOOL_NAMES,
  ReleaseStewardPostconditionError,
  ReleaseStewardToolBudget,
  createReleaseStewardRecorder,
  createReleaseStewardTools,
  releaseStewardToolNamesForPhase,
  runReleaseStewardObservation,
  validateReleaseStewardPostconditions,
} from "../src/index.js";
import { ScriptedEvidenceModel } from "../src/scripted-model.js";

const CANDIDATE = "c87fe1f418b155eb67740969355c7e2d7de97448";
const OLD_DEPLOYMENT = "294a5eb04e9667c797aa7a316d5896c84a4342a1";
const FETCHED_AT = "2026-08-24T02:00:00.000Z";
const RECHECK = Object.freeze({
  waitUntil: "2026-08-24T02:02:00.000Z",
  durationMs: 120_000,
  policyProfile: "fast-demo-v1",
});
const IMMUTABLE_IDS = Object.freeze({
  source: `github-commit:${CANDIDATE}`,
  ci: "github-actions-run:32668478052",
});

describe("state-scoped release steward tools", () => {
  it("exposes only the tools valid for each observation or action phase", () => {
    assert.deepEqual(releaseStewardToolNamesForPhase("FIRST_OBSERVATION"), [
      "observe_source_revision",
      "observe_required_ci",
      "observe_deployment_revision",
      "observe_homepage_smoke",
      "schedule_recheck",
    ]);
    assert.deepEqual(releaseStewardToolNamesForPhase("LATER_OBSERVATION"), [
      "observe_deployment_revision",
      "observe_homepage_smoke",
      "schedule_recheck",
    ]);
    assert.deepEqual(releaseStewardToolNamesForPhase("EXTENSION_OBSERVATION"), [
      "observe_deployment_revision",
      "observe_homepage_smoke",
    ]);
    assert.deepEqual(releaseStewardToolNamesForPhase("ESCALATION_RESUME"), [
      "create_github_incident",
    ]);
    assert.throws(
      () =>
        createReleaseStewardTools(
          "ESCALATION_RESUME",
          createReleaseStewardRecorder(),
        ),
      /separately authorized incident tool/,
    );
  });

  it("rejects duplicate, foreign, and state-invalid tool calls before execution", () => {
    const budget = new ReleaseStewardToolBudget("EXTENSION_OBSERVATION");

    assert.equal(
      budget.checkAndRecord(RELEASE_STEWARD_TOOL_NAMES.deployment),
      undefined,
    );
    assert.match(
      budget.checkAndRecord(RELEASE_STEWARD_TOOL_NAMES.deployment) ?? "",
      /already used/,
    );
    assert.match(
      budget.checkAndRecord(RELEASE_STEWARD_TOOL_NAMES.recheck) ?? "",
      /outside.*allowlist/,
    );
    assert.match(budget.checkAndRecord("delete_repository") ?? "", /outside/);
    assert.throws(() => budget.assertNoViolations(), /tool-budget violation/);
    assert.deepEqual(budget.callCounts(), {
      observe_deployment_revision: 1,
      observe_homepage_smoke: 0,
    });
  });

  it("binds the first source, CI, deployment, and smoke cycle with zero writes", async () => {
    let githubCalls = 0;
    const result = await runReleaseStewardObservation({
      phase: "FIRST_OBSERVATION",
      candidateCommit: CANDIDATE,
      modelMode: "injected-test",
      model: new ScriptedEvidenceModel(
        [
          RELEASE_STEWARD_TOOL_NAMES.source,
          RELEASE_STEWARD_TOOL_NAMES.ci,
          RELEASE_STEWARD_TOOL_NAMES.deployment,
          RELEASE_STEWARD_TOOL_NAMES.smoke,
        ],
        "Narrative recommendation: wait, even though the candidate is ready.",
      ),
      githubCollector: async () => {
        githubCalls += 1;
        return githubBundle();
      },
      deploymentCollector: async () => deploymentBundle(CANDIDATE),
      homepageCollector: async () => homepageBundle(),
      recheckProposal: RECHECK,
    });

    assert.equal(githubCalls, 1);
    assert.equal(result.postcondition.signal, "CANDIDATE_READY");
    assert.match(result.modelNarration, /recommendation: wait/);
    assert.deepEqual(
      result.receipts.map((receipt) => receipt.toolName),
      [
        "observe_source_revision",
        "observe_required_ci",
        "observe_deployment_revision",
        "observe_homepage_smoke",
      ],
    );
    assert.deepEqual(result.toolCallCounts, {
      observe_source_revision: 1,
      observe_required_ci: 1,
      observe_deployment_revision: 1,
      observe_homepage_smoke: 1,
      schedule_recheck: 0,
    });
    assert.deepEqual(
      result.evidence.map((evidence) => evidence.evidenceId),
      result.receipts.map((receipt) => receipt.evidenceId),
    );
    assert.equal(result.externalMutations, 0);
    assert.equal(
      result.receipts.every((receipt) => receipt.externalMutations === 0),
      true,
    );
  });

  it("uses only deployment, smoke, and a policy-clamped wait on later cycles", async () => {
    const result = await runReleaseStewardObservation({
      phase: "LATER_OBSERVATION",
      candidateCommit: CANDIDATE,
      immutableEvidenceIds: IMMUTABLE_IDS,
      modelMode: "injected-test",
      model: new ScriptedEvidenceModel([
        RELEASE_STEWARD_TOOL_NAMES.deployment,
        RELEASE_STEWARD_TOOL_NAMES.smoke,
        RELEASE_STEWARD_TOOL_NAMES.recheck,
      ]),
      deploymentCollector: async () => deploymentBundle(OLD_DEPLOYMENT),
      homepageCollector: async () => homepageBundle(),
      recheckProposal: RECHECK,
    });

    assert.equal(result.postcondition.signal, "NORMAL_WAIT_REQUIRED");
    assert.equal(result.postcondition.sourceEvidenceId, IMMUTABLE_IDS.source);
    assert.equal(result.postcondition.ciEvidenceId, IMMUTABLE_IDS.ci);
    assert.deepEqual(result.toolCallCounts, {
      observe_deployment_revision: 1,
      observe_homepage_smoke: 1,
      schedule_recheck: 1,
    });
    assert.equal(
      result.evidence.find((item) => item.kind === "Recheck proposal")
        ?.durationMs,
      120_000,
    );
  });

  it("cannot schedule a second checkpoint in an exhausted extension", async () => {
    const result = await runReleaseStewardObservation({
      phase: "EXTENSION_OBSERVATION",
      candidateCommit: CANDIDATE,
      immutableEvidenceIds: IMMUTABLE_IDS,
      modelMode: "injected-test",
      model: new ScriptedEvidenceModel([
        RELEASE_STEWARD_TOOL_NAMES.deployment,
        RELEASE_STEWARD_TOOL_NAMES.smoke,
      ]),
      deploymentCollector: async () => deploymentBundle(OLD_DEPLOYMENT),
      homepageCollector: async () => homepageBundle(),
    });

    assert.equal(result.postcondition.signal, "EXTENSION_EXHAUSTED");
    assert.deepEqual(result.toolCallCounts, {
      observe_deployment_revision: 1,
      observe_homepage_smoke: 1,
    });
  });

  it("fails closed when receipts are incomplete, reordered, or unbound", async () => {
    const valid = await runReleaseStewardObservation({
      phase: "FIRST_OBSERVATION",
      candidateCommit: CANDIDATE,
      modelMode: "injected-test",
      model: new ScriptedEvidenceModel([
        RELEASE_STEWARD_TOOL_NAMES.source,
        RELEASE_STEWARD_TOOL_NAMES.ci,
        RELEASE_STEWARD_TOOL_NAMES.deployment,
        RELEASE_STEWARD_TOOL_NAMES.smoke,
      ]),
      githubCollector: async () => githubBundle(),
      deploymentCollector: async () => deploymentBundle(CANDIDATE),
      homepageCollector: async () => homepageBundle(),
      recheckProposal: RECHECK,
    });

    assert.throws(
      () =>
        validateReleaseStewardPostconditions({
          phase: "FIRST_OBSERVATION",
          candidateCommit: CANDIDATE,
          evidence: valid.evidence.slice(0, 3),
          receipts: valid.receipts.slice(0, 3),
        }),
      postconditionError,
    );
    assert.throws(
      () =>
        validateReleaseStewardPostconditions({
          phase: "FIRST_OBSERVATION",
          candidateCommit: CANDIDATE,
          evidence: valid.evidence,
          receipts: [
            valid.receipts[0]!,
            valid.receipts[1]!,
            valid.receipts[3]!,
            valid.receipts[2]!,
          ],
        }),
      postconditionError,
    );
    assert.throws(
      () =>
        validateReleaseStewardPostconditions({
          phase: "FIRST_OBSERVATION",
          candidateCommit: CANDIDATE,
          evidence: valid.evidence,
          receipts: valid.receipts.map((receipt, index) =>
            index === 2
              ? { ...receipt, evidenceId: "foreign:evidence" }
              : receipt,
          ),
        }),
      postconditionError,
    );
  });

  it("requires explicit model injection instead of silently selecting a script", async () => {
    await assert.rejects(
      runReleaseStewardObservation({
        phase: "EXTENSION_OBSERVATION",
        candidateCommit: CANDIDATE,
        immutableEvidenceIds: IMMUTABLE_IDS,
        modelMode: "injected-test",
        model: undefined as never,
      }),
      /model injection is required/,
    );

    await assert.rejects(
      runReleaseStewardObservation({
        phase: "EXTENSION_OBSERVATION",
        candidateCommit: CANDIDATE,
        immutableEvidenceIds: IMMUTABLE_IDS,
        modelMode: "bedrock-live",
        model: new ScriptedEvidenceModel([
          RELEASE_STEWARD_TOOL_NAMES.deployment,
          RELEASE_STEWARD_TOOL_NAMES.smoke,
        ]),
      }),
      /bedrock-live mode refuses.*scripted/,
    );
  });
});

function githubBundle(): GitHubEvidenceBundle {
  return Object.freeze({
    target: Object.freeze({
      repository: "YongHwan2161/quietops",
      ref: "main",
      requiredWorkflow: "Verify",
    }),
    source: Object.freeze({
      evidenceId: `github-commit:${CANDIDATE}`,
      kind: "Source revision",
      status: "Verified",
      value: CANDIDATE,
      sourceUrl: `https://github.com/YongHwan2161/quietops/commit/${CANDIDATE}`,
      fetchedAt: FETCHED_AT,
    }),
    ci: Object.freeze({
      evidenceId: "github-actions-run:32668478052",
      kind: "CI status",
      status: "Verified",
      value: "success",
      sourceUrl:
        "https://github.com/YongHwan2161/quietops/actions/runs/32668478052",
      fetchedAt: FETCHED_AT,
      workflowName: "Verify",
      runId: 32668478052,
      headSha: CANDIDATE,
      completedAt: FETCHED_AT,
    }),
    externalMutations: 0,
  });
}

function deploymentBundle(commit: string): DeploymentEvidenceBundle {
  const markerUrl =
    "https://quietops-production.up.railway.app/.well-known/quietops-release.json";
  return Object.freeze({
    target: Object.freeze({
      repository: "YongHwan2161/quietops",
      markerUrl,
    }),
    deployment: Object.freeze({
      evidenceId: `deployment-marker:${commit}`,
      kind: "Deployed revision",
      status: "Verified",
      value: commit,
      sourceUrl: markerUrl,
      fetchedAt: FETCHED_AT,
    }),
    externalMutations: 0,
  });
}

function homepageBundle(): HomepageSmokeBundle {
  const homepageUrl = "https://quietops-production.up.railway.app/";
  return Object.freeze({
    target: Object.freeze({
      repository: "YongHwan2161/quietops",
      homepageUrl,
    }),
    smoke: Object.freeze({
      evidenceId: `homepage-smoke:quietops-production.up.railway.app:${FETCHED_AT}`,
      kind: "Homepage smoke",
      status: "Verified",
      value: "healthy",
      sourceUrl: homepageUrl,
      fetchedAt: FETCHED_AT,
      httpStatus: 200,
      contentType: "text/html; charset=utf-8",
      bodyBytes: 128,
      productMarker: 'data-quietops-product="release-steward"',
    }),
    externalMutations: 0,
  });
}

function postconditionError(error: unknown): boolean {
  assert.equal(error instanceof ReleaseStewardPostconditionError, true);
  return true;
}
