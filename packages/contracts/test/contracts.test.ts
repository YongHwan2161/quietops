import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONTRACT_SCHEMA_VERSION,
  ContractValidationError,
  EVALUATION_OUTCOMES,
  EVIDENCE_STATUSES,
  HUMAN_DECISIONS,
  isVerifiedEvidenceStatus,
  parseCandidateIdentity,
  parseEvaluationOutcome,
  parseEvidenceStatus,
  parseHumanDecision,
} from "../src/index.js";

const VALID_CANDIDATE = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  repository: "YongHwan2161/quietops",
  branch: "main",
  commit: "311238afe40b1b7d7d28c58eca40ccbd18aae892",
  deploymentUrl: "http://127.0.0.1:3000/ready",
} as const;

describe("candidate identity", () => {
  it("accepts and freezes an exact candidate identity", () => {
    const candidate = parseCandidateIdentity(VALID_CANDIDATE);

    assert.deepEqual(candidate, VALID_CANDIDATE);
    assert.equal(Object.isFrozen(candidate), true);
  });

  it("round-trips through JSON without changing the contract", () => {
    const serialized = JSON.stringify(parseCandidateIdentity(VALID_CANDIDATE));
    const restored: unknown = JSON.parse(serialized);

    assert.deepEqual(parseCandidateIdentity(restored), VALID_CANDIDATE);
  });

  it("rejects abbreviated or malformed commit identities", () => {
    assert.throws(
      () =>
        parseCandidateIdentity({
          ...VALID_CANDIDATE,
          commit: "311238a",
        }),
      ContractValidationError,
    );
  });

  it("rejects credentials, fragments, and unknown fields", () => {
    assert.throws(
      () =>
        parseCandidateIdentity({
          ...VALID_CANDIDATE,
          deploymentUrl: "https://user:secret@example.test/build#details",
          unexpected: true,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ContractValidationError);
        assert.deepEqual(
          error.issues.map((issue) => issue.path),
          ["$.unexpected", "$.deploymentUrl"],
        );
        return true;
      },
    );
  });
});

describe("shared vocabulary", () => {
  it("parses every declared vocabulary value", () => {
    assert.deepEqual(
      EVIDENCE_STATUSES.map(parseEvidenceStatus),
      EVIDENCE_STATUSES,
    );
    assert.deepEqual(
      EVALUATION_OUTCOMES.map(parseEvaluationOutcome),
      EVALUATION_OUTCOMES,
    );
    assert.deepEqual(HUMAN_DECISIONS.map(parseHumanDecision), HUMAN_DECISIONS);
  });

  it("rejects values outside the SSOT vocabulary", () => {
    assert.throws(() => parseEvidenceStatus("Passed"), ContractValidationError);
    assert.throws(
      () => parseEvaluationOutcome("Approved"),
      ContractValidationError,
    );
    assert.throws(
      () => parseHumanDecision("Accept risk"),
      ContractValidationError,
    );
  });

  it("never treats non-Verified evidence as verified", () => {
    for (const status of EVIDENCE_STATUSES) {
      assert.equal(isVerifiedEvidenceStatus(status), status === "Verified");
    }

    for (const unsafeValue of [undefined, null, true, "verified", "Passed"]) {
      assert.equal(isVerifiedEvidenceStatus(unsafeValue), false);
    }
  });

  it("freezes vocabulary collections against runtime mutation", () => {
    assert.equal(Object.isFrozen(EVIDENCE_STATUSES), true);
    assert.equal(Object.isFrozen(EVALUATION_OUTCOMES), true);
    assert.equal(Object.isFrozen(HUMAN_DECISIONS), true);
  });
});
