import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEPLOYMENT_EVIDENCE_ERROR_CODES,
  DeploymentEvidenceError,
  createDeploymentRevisionCollector,
  type DeploymentEvidenceTarget,
} from "../src/index.js";

const COMMIT = "294a5eb04e9667c797aa7a316d5896c84a4342a1";
const MARKER_URL =
  "https://release.quietops.example/.well-known/quietops-release.json";
const TARGET: DeploymentEvidenceTarget = Object.freeze({
  repository: "YongHwan2161/quietops",
  markerUrl: MARKER_URL,
});

describe("deployment revision marker adapter", () => {
  it("collects one exact read-only revision from its construction-bound target", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const collect = createDeploymentRevisionCollector(TARGET, {
      clock: () => new Date("2026-08-22T02:00:00.000Z"),
      fetchImplementation: async (input, init) => {
        requests.push({ url: input.toString(), ...(init ? { init } : {}) });
        return markerResponse();
      },
    });

    const result = await collect();

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, MARKER_URL);
    assert.equal(requests[0]?.init?.method, "GET");
    assert.equal(requests[0]?.init?.redirect, "error");
    assert.equal(
      new Headers(requests[0]?.init?.headers).has("Authorization"),
      false,
    );
    assert.deepEqual(result.deployment, {
      evidenceId: `deployment-marker:${COMMIT}`,
      kind: "Deployed revision",
      status: "Verified",
      value: COMMIT,
      sourceUrl: MARKER_URL,
      fetchedAt: "2026-08-22T02:00:00.000Z",
    });
    assert.equal(result.externalMutations, 0);
  });

  it("rejects unsafe targets before any network request can be made", () => {
    assert.throws(
      () =>
        createDeploymentRevisionCollector({
          repository: "someone/else" as DeploymentEvidenceTarget["repository"],
          markerUrl: MARKER_URL,
        }),
      targetNotAllowed,
    );

    const invalidTargets = [
      "http://release.quietops.example/.well-known/quietops-release.json",
      "https://user:secret@release.quietops.example/.well-known/quietops-release.json",
      "https://release.quietops.example:8443/.well-known/quietops-release.json",
      "https://release.quietops.example/version.json",
      "https://release.quietops.example/.well-known/quietops-release.json?next=https://example.com",
      "https://release.quietops.example/.well-known/quietops-release.json#commit",
    ];

    for (const markerUrl of invalidTargets) {
      assert.throws(
        () => createDeploymentRevisionCollector({ ...TARGET, markerUrl }),
        targetNotAllowed,
      );
    }
  });

  it("rejects malformed or repository-unbound marker payloads", async () => {
    const payloads = [
      { schemaVersion: "1", repository: "someone/else", commit: COMMIT },
      {
        schemaVersion: "1",
        repository: "YongHwan2161/quietops",
        commit: "short",
      },
      {
        schemaVersion: "1",
        repository: "YongHwan2161/quietops",
        commit: COMMIT,
        unexpected: true,
      },
    ];

    for (const payload of payloads) {
      const collect = createDeploymentRevisionCollector(TARGET, {
        fetchImplementation: async () => markerResponse(payload),
      });
      await assert.rejects(collect(), responseInvalid);
    }

    const wrongContentType = createDeploymentRevisionCollector(TARGET, {
      fetchImplementation: async () =>
        new Response(JSON.stringify(markerPayload()), {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
    });
    await assert.rejects(wrongContentType(), responseInvalid);
  });

  it("maps missing, oversized, and timed-out reads to stable failures", async () => {
    const missing = createDeploymentRevisionCollector(TARGET, {
      fetchImplementation: async () => new Response("missing", { status: 404 }),
    });
    await assert.rejects(missing(), (error: unknown) => {
      assert.equal(
        (error as DeploymentEvidenceError).code,
        DEPLOYMENT_EVIDENCE_ERROR_CODES.notFound,
      );
      return true;
    });

    const oversized = createDeploymentRevisionCollector(TARGET, {
      fetchImplementation: async () =>
        new Response("{}", {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "64001",
          },
        }),
    });
    await assert.rejects(oversized(), (error: unknown) => {
      assert.equal(
        (error as DeploymentEvidenceError).code,
        DEPLOYMENT_EVIDENCE_ERROR_CODES.responseTooLarge,
      );
      return true;
    });

    const timedOut = createDeploymentRevisionCollector(TARGET, {
      timeoutMs: 100,
      fetchImplementation: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    });
    await assert.rejects(timedOut(), (error: unknown) => {
      assert.equal(
        (error as DeploymentEvidenceError).code,
        DEPLOYMENT_EVIDENCE_ERROR_CODES.timeout,
      );
      return true;
    });
  });
});

function markerPayload(): Record<string, unknown> {
  return {
    schemaVersion: "1",
    repository: "YongHwan2161/quietops",
    commit: COMMIT,
  };
}

function markerResponse(value: unknown = markerPayload()): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function responseInvalid(error: unknown): boolean {
  assert.equal(error instanceof DeploymentEvidenceError, true);
  assert.equal(
    (error as DeploymentEvidenceError).code,
    DEPLOYMENT_EVIDENCE_ERROR_CODES.responseInvalid,
  );
  return true;
}

function targetNotAllowed(error: unknown): boolean {
  assert.equal(error instanceof DeploymentEvidenceError, true);
  assert.equal(
    (error as DeploymentEvidenceError).code,
    DEPLOYMENT_EVIDENCE_ERROR_CODES.targetNotAllowed,
  );
  return true;
}
