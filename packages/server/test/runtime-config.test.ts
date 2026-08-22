import assert from "node:assert/strict";
import test from "node:test";

import { resolveQuietOpsRuntimeConfig } from "../src/index.js";

const COMMIT = "924686c12afbcd437466fd56d0ea24be8df36696";

test("defaults to the local interactive loopback runtime", () => {
  assert.deepEqual(resolveQuietOpsRuntimeConfig({}), {
    host: "127.0.0.1",
    port: 4173,
    decisionMode: "local-interactive",
  });
});

test("accepts a public read-only platform binding", () => {
  assert.deepEqual(
    resolveQuietOpsRuntimeConfig({
      QUIETOPS_HOST: "0.0.0.0",
      PORT: "8080",
      QUIETOPS_DECISION_MODE: "public-read-only",
      QUIETOPS_RELEASE_COMMIT: COMMIT,
    }),
    {
      host: "0.0.0.0",
      port: 8080,
      decisionMode: "public-read-only",
      releaseCommit: COMMIT,
    },
  );
});

test("keeps the local port alias and accepts matching dual configuration", () => {
  assert.equal(
    resolveQuietOpsRuntimeConfig({ QUIETOPS_PORT: "4317" }).port,
    4317,
  );
  assert.equal(
    resolveQuietOpsRuntimeConfig({ PORT: "4317", QUIETOPS_PORT: "04317" }).port,
    4317,
  );
});

test("rejects conflicting or invalid ports", () => {
  assert.throws(
    () => resolveQuietOpsRuntimeConfig({ PORT: "8080", QUIETOPS_PORT: "4173" }),
    /must match/,
  );
  for (const value of ["", "0", "65536", "12.5", "-1", " 8080"]) {
    assert.throws(
      () => resolveQuietOpsRuntimeConfig({ PORT: value }),
      /PORT must be an integer from 1 through 65535/,
    );
  }
});

test("rejects non-allowlisted hosts and an interactive public bind", () => {
  for (const host of ["localhost", "::", "example.com", "127.0.0.2"]) {
    assert.throws(
      () => resolveQuietOpsRuntimeConfig({ QUIETOPS_HOST: host }),
      /QUIETOPS_HOST must be 127\.0\.0\.1 or 0\.0\.0\.0/,
    );
  }
  assert.throws(
    () =>
      resolveQuietOpsRuntimeConfig({
        QUIETOPS_HOST: "0.0.0.0",
        QUIETOPS_RELEASE_COMMIT: COMMIT,
      }),
    /requires QUIETOPS_DECISION_MODE=public-read-only/,
  );
  assert.throws(
    () =>
      resolveQuietOpsRuntimeConfig({
        QUIETOPS_HOST: "0.0.0.0",
        QUIETOPS_DECISION_MODE: "public-read-only",
      }),
    /requires a full QUIETOPS_RELEASE_COMMIT/,
  );
});

test("rejects an unknown decision mode or invalid release commit", () => {
  assert.throws(
    () =>
      resolveQuietOpsRuntimeConfig({
        QUIETOPS_DECISION_MODE: "public-interactive",
      }),
    /QUIETOPS_DECISION_MODE must be local-interactive or public-read-only/,
  );
  for (const releaseCommit of [
    "",
    "short",
    COMMIT.toUpperCase(),
    `${COMMIT}0`,
  ]) {
    assert.throws(
      () =>
        resolveQuietOpsRuntimeConfig({
          QUIETOPS_RELEASE_COMMIT: releaseCommit,
        }),
      /QUIETOPS_RELEASE_COMMIT must be 40 lowercase hexadecimal characters/,
    );
  }
});
