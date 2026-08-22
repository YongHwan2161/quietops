import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GITHUB_EVIDENCE_ERROR_CODES,
  GitHubEvidenceError,
  QUIETOPS_GITHUB_TARGET,
  collectGitHubSourceAndCiEvidence,
} from "../src/index.js";

const COMMIT = "294a5eb04e9667c797aa7a316d5896c84a4342a1";
const COMMIT_URL = `https://github.com/YongHwan2161/quietops/commit/${COMMIT}`;
const RUN_URL =
  "https://github.com/YongHwan2161/quietops/actions/runs/32468420217";

describe("GitHub source and CI evidence adapter", () => {
  it("collects a bounded source revision and exact required CI run", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const result = await collectGitHubSourceAndCiEvidence(
      QUIETOPS_GITHUB_TARGET,
      {
        clock: () => new Date("2026-08-21T15:00:00.000Z"),
        fetchImplementation: async (input, init) => {
          const url = input.toString();
          requests.push({ url, ...(init ? { init } : {}) });
          if (url.endsWith("/commits/main")) {
            return jsonResponse({ sha: COMMIT, html_url: COMMIT_URL });
          }
          return jsonResponse({
            workflow_runs: [
              workflowRun({
                id: 32468420217,
                conclusion: "success",
                updated_at: "2026-08-21T13:00:00Z",
              }),
              workflowRun({
                id: 32460000000,
                name: "Untrusted workflow",
                conclusion: "success",
                updated_at: "2026-08-21T14:00:00Z",
              }),
            ],
          });
        },
      },
    );

    assert.equal(requests.length, 2);
    assert.equal(
      requests[0]?.url,
      "https://api.github.com/repos/YongHwan2161/quietops/commits/main",
    );
    const runsUrl = new URL(requests[1]?.url ?? "");
    assert.equal(runsUrl.origin, "https://api.github.com");
    assert.equal(runsUrl.searchParams.get("branch"), "main");
    assert.equal(runsUrl.searchParams.get("head_sha"), COMMIT);
    assert.equal(runsUrl.searchParams.get("status"), "completed");
    assert.equal(
      requests.every((request) => request.init?.method === "GET"),
      true,
    );
    assert.equal(
      requests.every((request) => request.init?.redirect === "error"),
      true,
    );
    assert.equal(
      requests.every(
        (request) => !new Headers(request.init?.headers).has("Authorization"),
      ),
      true,
    );
    assert.deepEqual(result.source, {
      evidenceId: `github-commit:${COMMIT}`,
      kind: "Source revision",
      status: "Verified",
      value: COMMIT,
      sourceUrl: COMMIT_URL,
      fetchedAt: "2026-08-21T15:00:00.000Z",
    });
    assert.deepEqual(result.ci, {
      evidenceId: "github-actions-run:32468420217",
      kind: "CI status",
      status: "Verified",
      value: "success",
      sourceUrl: RUN_URL,
      fetchedAt: "2026-08-21T15:00:00.000Z",
      workflowName: "Verify",
      runId: 32468420217,
      headSha: COMMIT,
      completedAt: "2026-08-21T13:00:00Z",
    });
    assert.equal(result.externalMutations, 0);
  });

  it("preserves a completed failed workflow as observed non-passing evidence", async () => {
    const result = await collectGitHubSourceAndCiEvidence(
      QUIETOPS_GITHUB_TARGET,
      {
        fetchImplementation: sequencedFetch([
          { sha: COMMIT, html_url: COMMIT_URL },
          {
            workflow_runs: [workflowRun({ id: 7, conclusion: "failure" })],
          },
        ]),
      },
    );

    assert.equal(result.ci.status, "Verified");
    assert.equal(result.ci.value, "failure");
    assert.notEqual(result.ci.value, "success");
    assert.equal(result.externalMutations, 0);
  });

  it("fails closed when the required workflow is missing", async () => {
    await assert.rejects(
      collectGitHubSourceAndCiEvidence(QUIETOPS_GITHUB_TARGET, {
        fetchImplementation: sequencedFetch([
          { sha: COMMIT, html_url: COMMIT_URL },
          { workflow_runs: [] },
        ]),
      }),
      (error: unknown) => {
        assert.equal(error instanceof GitHubEvidenceError, true);
        assert.equal(
          (error as GitHubEvidenceError).code,
          GITHUB_EVIDENCE_ERROR_CODES.workflowNotFound,
        );
        return true;
      },
    );
  });

  it("rejects targets outside the fixed allowlist before network access", async () => {
    let called = false;
    await assert.rejects(
      collectGitHubSourceAndCiEvidence(
        { ...QUIETOPS_GITHUB_TARGET, repository: "someone/else" },
        {
          fetchImplementation: async () => {
            called = true;
            return jsonResponse({});
          },
        },
      ),
      (error: unknown) => {
        assert.equal(error instanceof GitHubEvidenceError, true);
        assert.equal(
          (error as GitHubEvidenceError).code,
          GITHUB_EVIDENCE_ERROR_CODES.targetNotAllowed,
        );
        return true;
      },
    );
    assert.equal(called, false);
  });

  it("maps invalid payloads and rate limits to stable fail-closed errors", async () => {
    await assert.rejects(
      collectGitHubSourceAndCiEvidence(QUIETOPS_GITHUB_TARGET, {
        fetchImplementation: async () => jsonResponse({ sha: "short" }),
      }),
      (error: unknown) => {
        assert.equal(
          (error as GitHubEvidenceError).code,
          GITHUB_EVIDENCE_ERROR_CODES.responseInvalid,
        );
        return true;
      },
    );

    await assert.rejects(
      collectGitHubSourceAndCiEvidence(QUIETOPS_GITHUB_TARGET, {
        fetchImplementation: async () =>
          new Response("limited", { status: 429 }),
      }),
      (error: unknown) => {
        assert.equal(
          (error as GitHubEvidenceError).code,
          GITHUB_EVIDENCE_ERROR_CODES.rateLimited,
        );
        return true;
      },
    );
  });

  it("enforces response-size and whole-response timeout bounds", async () => {
    await assert.rejects(
      collectGitHubSourceAndCiEvidence(QUIETOPS_GITHUB_TARGET, {
        fetchImplementation: async () =>
          new Response("{}", {
            status: 200,
            headers: { "Content-Length": "1000001" },
          }),
      }),
      (error: unknown) => {
        assert.equal(
          (error as GitHubEvidenceError).code,
          GITHUB_EVIDENCE_ERROR_CODES.responseTooLarge,
        );
        return true;
      },
    );

    await assert.rejects(
      collectGitHubSourceAndCiEvidence(QUIETOPS_GITHUB_TARGET, {
        timeoutMs: 100,
        fetchImplementation: async (_input, init) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      }),
      (error: unknown) => {
        assert.equal(
          (error as GitHubEvidenceError).code,
          GITHUB_EVIDENCE_ERROR_CODES.timeout,
        );
        return true;
      },
    );
  });
});

function workflowRun(
  overrides: Partial<{
    id: number;
    name: string;
    head_branch: string;
    head_sha: string;
    status: "completed";
    conclusion: string;
    html_url: string;
    updated_at: string;
  }> = {},
): Record<string, unknown> {
  return {
    id: 32468420217,
    name: "Verify",
    head_branch: "main",
    head_sha: COMMIT,
    status: "completed",
    conclusion: "success",
    html_url: RUN_URL,
    updated_at: "2026-08-21T13:00:00Z",
    ...overrides,
  };
}

function sequencedFetch(payloads: readonly unknown[]): typeof fetch {
  let index = 0;
  return async () => {
    const payload = payloads[index];
    index += 1;
    return jsonResponse(payload);
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
