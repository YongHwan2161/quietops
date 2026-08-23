import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  GitHubWebhookAuthenticationError,
  GitHubWebhookRequestError,
  MAX_GITHUB_WEBHOOK_BODY_BYTES,
  inspectGitHubPushWebhook,
  verifyGitHubWebhookSignature,
} from "../src/index.js";

const OFFICIAL_SECRET = "It's a Secret to Everybody";
const OFFICIAL_PAYLOAD = Buffer.from("Hello, World!", "utf8");
const OFFICIAL_SIGNATURE =
  "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
const SECRET = "quietops-test-webhook-secret-32-bytes-minimum";
const COMMIT = "d4fb420548fe562f5d405dba51057b93b2204bb0";

test("matches GitHub's published HMAC-SHA256 test vector", () => {
  assert.equal(
    verifyGitHubWebhookSignature(
      OFFICIAL_PAYLOAD,
      OFFICIAL_SECRET,
      OFFICIAL_SIGNATURE,
    ),
    true,
  );
  assert.equal(
    verifyGitHubWebhookSignature(
      OFFICIAL_PAYLOAD,
      OFFICIAL_SECRET,
      `${OFFICIAL_SIGNATURE.slice(0, -1)}0`,
    ),
    false,
  );
  assert.equal(
    verifyGitHubWebhookSignature(
      OFFICIAL_PAYLOAD,
      OFFICIAL_SECRET,
      "sha256=short",
    ),
    false,
  );
});

test("authenticates the untouched bytes before attempting JSON parsing", () => {
  const invalidJson = Buffer.from("not-json", "utf8");
  assert.throws(
    () =>
      inspectGitHubPushWebhook({
        rawBody: invalidJson,
        secret: SECRET,
        signature: "sha256=".padEnd(71, "0"),
        event: "push",
        deliveryId: "delivery-invalid-json",
      }),
    GitHubWebhookAuthenticationError,
  );
  assert.throws(
    () =>
      inspectGitHubPushWebhook({
        rawBody: invalidJson,
        secret: SECRET,
        signature: sign(invalidJson),
        event: "push",
        deliveryId: "delivery-invalid-json",
      }),
    (error: unknown) =>
      error instanceof GitHubWebhookRequestError &&
      error.code === "GITHUB_WEBHOOK_INVALID_JSON",
  );
});

test("accepts only the fixed non-deleted main push with a full commit", () => {
  const accepted = inspect(payload());
  assert.deepEqual(accepted, {
    accepted: true,
    deliveryId: "delivery-01",
    candidateCommit: COMMIT,
  });

  const cases = [
    {
      body: payload({ repository: { full_name: "someone/else" } }),
      reason: "foreign-repository",
    },
    {
      body: payload({ ref: "refs/heads/feature" }),
      reason: "foreign-ref",
    },
    { body: payload({ deleted: true }), reason: "deleted-push" },
    { body: payload({ after: COMMIT.toUpperCase() }), reason: "invalid-after" },
  ] as const;
  for (const entry of cases) {
    assert.deepEqual(inspect(entry.body), {
      accepted: false,
      deliveryId: "delivery-01",
      reason: entry.reason,
    });
  }

  assert.deepEqual(inspect(payload(), { event: "issues" }), {
    accepted: false,
    deliveryId: "delivery-01",
    reason: "unsupported-event",
  });
});

test("rejects oversized, invalid-delivery, and incomplete authenticated input", () => {
  const oversized = Buffer.alloc(MAX_GITHUB_WEBHOOK_BODY_BYTES + 1, 0x61);
  assert.throws(
    () => inspect(oversized),
    (error: unknown) =>
      error instanceof GitHubWebhookRequestError &&
      error.code === "GITHUB_WEBHOOK_BODY_TOO_LARGE",
  );

  const validBody = payload();
  assert.throws(
    () => inspect(validBody, { deliveryId: "bad delivery" }),
    (error: unknown) =>
      error instanceof GitHubWebhookRequestError &&
      error.code === "GITHUB_WEBHOOK_INVALID_DELIVERY",
  );

  const incomplete = Buffer.from(JSON.stringify({ ref: "refs/heads/main" }));
  assert.throws(
    () => inspect(incomplete),
    (error: unknown) =>
      error instanceof GitHubWebhookRequestError &&
      error.code === "GITHUB_WEBHOOK_INVALID_PAYLOAD",
  );
});

function inspect(
  rawBody: Buffer,
  overrides: Partial<{
    event: string;
    deliveryId: string;
  }> = {},
) {
  return inspectGitHubPushWebhook({
    rawBody,
    secret: SECRET,
    signature: sign(rawBody),
    event: overrides.event ?? "push",
    deliveryId: overrides.deliveryId ?? "delivery-01",
  });
}

function payload(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      ref: "refs/heads/main",
      after: COMMIT,
      deleted: false,
      repository: { full_name: "YongHwan2161/quietops" },
      ...overrides,
    }),
    "utf8",
  );
}

function sign(body: Uint8Array): string {
  return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}
