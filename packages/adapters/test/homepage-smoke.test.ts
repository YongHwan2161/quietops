import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HOMEPAGE_SMOKE_ERROR_CODES,
  MAX_HOMEPAGE_SMOKE_BYTES,
  QUIETOPS_PRODUCT_MARKER,
  HomepageSmokeError,
  createHomepageSmokeCollector,
  type HomepageSmokeTarget,
} from "../src/index.js";

const HOMEPAGE_URL = "https://release.quietops.example/";
const TARGET: HomepageSmokeTarget = Object.freeze({
  repository: "YongHwan2161/quietops",
  homepageUrl: HOMEPAGE_URL,
});
const HTML = `<!doctype html><html><head><meta ${QUIETOPS_PRODUCT_MARKER}></head></html>`;

describe("homepage smoke adapter", () => {
  it("collects one bounded, read-only smoke receipt from its construction-bound target", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const collect = createHomepageSmokeCollector(TARGET, {
      clock: () => new Date("2026-08-24T01:02:03.000Z"),
      fetchImplementation: async (input, init) => {
        requests.push({ url: input.toString(), ...(init ? { init } : {}) });
        return htmlResponse(HTML);
      },
    });

    const result = await collect();

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, HOMEPAGE_URL);
    assert.equal(requests[0]?.init?.method, "GET");
    assert.equal(requests[0]?.init?.redirect, "error");
    assert.equal(
      new Headers(requests[0]?.init?.headers).has("Authorization"),
      false,
    );
    assert.deepEqual(result.smoke, {
      evidenceId:
        "homepage-smoke:release.quietops.example:2026-08-24T01:02:03.000Z",
      kind: "Homepage smoke",
      status: "Verified",
      value: "healthy",
      sourceUrl: HOMEPAGE_URL,
      fetchedAt: "2026-08-24T01:02:03.000Z",
      httpStatus: 200,
      contentType: "text/html; charset=utf-8",
      bodyBytes: new TextEncoder().encode(HTML).byteLength,
      productMarker: QUIETOPS_PRODUCT_MARKER,
    });
    assert.equal(result.externalMutations, 0);
  });

  it("rejects unsafe targets before a request", () => {
    assert.throws(
      () =>
        createHomepageSmokeCollector({
          repository: "someone/else" as HomepageSmokeTarget["repository"],
          homepageUrl: HOMEPAGE_URL,
        }),
      hasCode(HOMEPAGE_SMOKE_ERROR_CODES.targetNotAllowed),
    );

    for (const homepageUrl of [
      "http://release.quietops.example/",
      "https://user:secret@release.quietops.example/",
      "https://release.quietops.example:8443/",
      "https://release.quietops.example/app",
      "https://release.quietops.example/?target=other",
      "https://release.quietops.example/#result",
    ]) {
      assert.throws(
        () => createHomepageSmokeCollector({ ...TARGET, homepageUrl }),
        hasCode(HOMEPAGE_SMOKE_ERROR_CODES.targetNotAllowed),
      );
    }
  });

  it("fails closed on redirects, non-200 responses, and non-HTML bodies", async () => {
    const cases: ReadonlyArray<readonly [Response, string]> = [
      [
        new Response("redirect", {
          status: 302,
          headers: { Location: "https://other.example/" },
        }),
        HOMEPAGE_SMOKE_ERROR_CODES.redirect,
      ],
      [
        new Response("error", { status: 503 }),
        HOMEPAGE_SMOKE_ERROR_CODES.requestFailed,
      ],
      [
        new Response(HTML, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        HOMEPAGE_SMOKE_ERROR_CODES.nonHtml,
      ],
    ];

    for (const [response, code] of cases) {
      const collect = createHomepageSmokeCollector(TARGET, {
        fetchImplementation: async () => response,
      });
      await assert.rejects(collect(), hasCode(code));
    }
  });

  it("fails closed when the stable product marker is absent", async () => {
    const collect = createHomepageSmokeCollector(TARGET, {
      fetchImplementation: async () =>
        htmlResponse("<!doctype html><title>unbound page</title>"),
    });

    await assert.rejects(
      collect(),
      hasCode(HOMEPAGE_SMOKE_ERROR_CODES.unhealthy),
    );
  });

  it("rejects declared and streamed bodies over 256 KiB", async () => {
    const declared = createHomepageSmokeCollector(TARGET, {
      fetchImplementation: async () =>
        new Response(HTML, {
          status: 200,
          headers: {
            "Content-Type": "text/html",
            "Content-Length": String(MAX_HOMEPAGE_SMOKE_BYTES + 1),
          },
        }),
    });
    await assert.rejects(
      declared(),
      hasCode(HOMEPAGE_SMOKE_ERROR_CODES.responseTooLarge),
    );

    const streamed = createHomepageSmokeCollector(TARGET, {
      fetchImplementation: async () =>
        htmlResponse("x".repeat(MAX_HOMEPAGE_SMOKE_BYTES + 1)),
    });
    await assert.rejects(
      streamed(),
      hasCode(HOMEPAGE_SMOKE_ERROR_CODES.responseTooLarge),
    );
  });

  it("maps timeout and network failures to stable error codes", async () => {
    const timedOut = createHomepageSmokeCollector(TARGET, {
      timeoutMs: 100,
      fetchImplementation: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    });
    await assert.rejects(
      timedOut(),
      hasCode(HOMEPAGE_SMOKE_ERROR_CODES.timeout),
    );

    const bodyTimedOut = createHomepageSmokeCollector(TARGET, {
      timeoutMs: 100,
      fetchImplementation: async (_input, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("<!doctype html>"));
            init?.signal?.addEventListener("abort", () => {
              controller.error(new DOMException("aborted", "AbortError"));
            });
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      },
    });
    await assert.rejects(
      bodyTimedOut(),
      hasCode(HOMEPAGE_SMOKE_ERROR_CODES.timeout),
    );

    const network = createHomepageSmokeCollector(TARGET, {
      fetchImplementation: async () => {
        throw new TypeError("offline");
      },
    });
    await assert.rejects(
      network(),
      hasCode(HOMEPAGE_SMOKE_ERROR_CODES.network),
    );
  });
});

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function hasCode(expected: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert.equal(error instanceof HomepageSmokeError, true);
    assert.equal((error as HomepageSmokeError).code, expected);
    return true;
  };
}
