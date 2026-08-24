import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  QUIETOPS_GITHUB_INCIDENT_TARGET,
  buildGitHubIncidentPlan,
  executeGitHubIncident,
  type GitHubIncidentContext,
} from "../src/index.js";

const TOKEN = "item8-injected-test-token-never-persisted";
const CANDIDATE = "26875fb2f1eff59fef7d8fbf5b02d5c5dd505b72";

describe("fixed GitHub incident adapter", () => {
  it("builds one stable, evidence-linked request fingerprint", () => {
    const first = buildGitHubIncidentPlan(context());
    const second = buildGitHubIncidentPlan(context());
    assert.deepEqual(second, first);
    assert.equal(first.repository, "YongHwan2161/quietops");
    assert.equal(first.endpoint, QUIETOPS_GITHUB_INCIDENT_TARGET.endpoint);
    assert.match(first.requestFingerprint, /^[0-9a-f]{64}$/);
    assert.match(first.body, /QuietOps-Run: run-item-8/);
    assert.match(first.body, new RegExp(CANDIDATE));
    assert.match(first.body, /Required CI/);
    assert.match(first.body, /Measured wait: 5037 ms/);
    assert.equal(Object.isFrozen(first.context.evidence), true);
  });

  it("performs one exact POST and accepts only a bound 201 receipt", async () => {
    const plan = buildGitHubIncidentPlan(context());
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const result = await executeGitHubIncident(plan, {
      token: TOKEN,
      fetchImplementation: async (input, init = {}) => {
        calls.push({ input: String(input), init });
        return jsonResponse(201, {
          number: 42,
          html_url: "https://github.com/YongHwan2161/quietops/issues/42",
        });
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.input, QUIETOPS_GITHUB_INCIDENT_TARGET.endpoint);
    assert.equal(calls[0]?.init.method, "POST");
    assert.equal(calls[0]?.init.redirect, "error");
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
      title: plan.title,
      body: plan.body,
    });
    assert.equal(
      (calls[0]?.init.headers as Record<string, string>).Authorization,
      `Bearer ${TOKEN}`,
    );
    assert.equal(result.status, "CONFIRMED");
    assert.equal(result.providerRecordId, "42");
    assert.equal(
      result.providerUrl,
      "https://github.com/YongHwan2161/quietops/issues/42",
    );
    assert.match(result.responseDigest ?? "", /^[0-9a-f]{64}$/);
    assert.equal(result.externalWriteAttempts, 1);
    assert.equal(JSON.stringify({ plan, result }).includes(TOKEN), false);
  });

  it("classifies every deterministic 4xx as rejected with one call", async (t) => {
    for (const status of [400, 401, 403, 404, 410, 422, 429]) {
      await t.test(String(status), async () => {
        let calls = 0;
        const result = await executeGitHubIncident(
          buildGitHubIncidentPlan(context()),
          {
            token: TOKEN,
            fetchImplementation: async () => {
              calls += 1;
              return jsonResponse(status, { ignored: true });
            },
          },
        );
        assert.equal(calls, 1);
        assert.equal(result.status, "REJECTED");
        assert.match(result.responseDigest ?? "", /^[0-9a-f]{64}$/);
      });
    }
  });

  it("stops uncertain after 5xx, invalid success, network loss, or timeout", async (t) => {
    const cases: ReadonlyArray<{
      name: string;
      response?: () => Promise<Response>;
    }> = [
      { name: "500", response: async () => jsonResponse(500, {}) },
      { name: "503", response: async () => jsonResponse(503, {}) },
      { name: "unexpected-200", response: async () => jsonResponse(200, {}) },
      {
        name: "invalid-json-201",
        response: async () => new Response("not-json", { status: 201 }),
      },
      {
        name: "foreign-url-201",
        response: async () =>
          jsonResponse(201, {
            number: 42,
            html_url: "https://github.com/foreign/repository/issues/42",
          }),
      },
      {
        name: "invalid-number-201",
        response: async () =>
          jsonResponse(201, {
            number: 0,
            html_url: "https://github.com/YongHwan2161/quietops/issues/0",
          }),
      },
      { name: "network-loss" },
    ];
    for (const item of cases) {
      await t.test(item.name, async () => {
        let calls = 0;
        const result = await executeGitHubIncident(
          buildGitHubIncidentPlan(context()),
          {
            token: TOKEN,
            fetchImplementation: async () => {
              calls += 1;
              if (!item.response) throw new Error("connection lost");
              return await item.response();
            },
          },
        );
        assert.equal(calls, 1);
        assert.equal(result.status, "UNCERTAIN");
      });
    }

    await t.test("timeout", async () => {
      let calls = 0;
      const result = await executeGitHubIncident(
        buildGitHubIncidentPlan(context()),
        {
          token: TOKEN,
          timeoutMs: 100,
          fetchImplementation: async (_input, init) => {
            calls += 1;
            return await new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new Error("aborted")),
              );
            });
          },
        },
      );
      assert.equal(calls, 1);
      assert.equal(result.status, "UNCERTAIN");
    });
  });

  it("rejects a mutated plan before provider access", async () => {
    const plan = buildGitHubIncidentPlan(context());
    let calls = 0;
    await assert.rejects(
      executeGitHubIncident(
        { ...plan, body: `${plan.body}\nmutated after authorization` },
        {
          token: TOKEN,
          fetchImplementation: async () => {
            calls += 1;
            return jsonResponse(201, {});
          },
        },
      ),
      /immutable context/,
    );
    assert.equal(calls, 0);

    assert.throws(
      () =>
        buildGitHubIncidentPlan({
          ...context(),
          evidence: {
            ...context().evidence,
            source: {
              ...context().evidence.source,
              sourceUrl:
                "https://github.com/foreign/repository/commit/26875fb2f1eff59fef7d8fbf5b02d5c5dd505b72",
            },
          },
        }),
      /not bound to the candidate/,
    );
  });
});

function context(): GitHubIncidentContext {
  return {
    runId: "run-item-8",
    candidateCommit: CANDIDATE,
    decisionId: "decision-item-8",
    authorizedAt: "2026-08-24T10:00:00.000Z",
    observationCount: 2,
    measuredWaitMs: 5_037,
    evidence: {
      source: {
        evidenceId: `github-commit:${CANDIDATE}`,
        fetchedAt: "2026-08-24T09:59:40.000Z",
        sourceUrl: `https://github.com/YongHwan2161/quietops/commit/${CANDIDATE}`,
      },
      ci: {
        evidenceId: "github-actions-run:32718604234",
        fetchedAt: "2026-08-24T09:59:41.000Z",
        sourceUrl:
          "https://github.com/YongHwan2161/quietops/actions/runs/32718604234",
      },
      deployment: {
        evidenceId: "deployment-marker:old-release",
        fetchedAt: "2026-08-24T09:59:58.000Z",
        sourceUrl:
          "https://quietops-production.up.railway.app/.well-known/quietops-release.json",
      },
      homepageSmoke: {
        evidenceId: "homepage-smoke:healthy",
        fetchedAt: "2026-08-24T09:59:59.000Z",
        sourceUrl: "https://quietops-production.up.railway.app/",
      },
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
