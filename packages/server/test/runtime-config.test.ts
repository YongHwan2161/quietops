import assert from "node:assert/strict";
import test from "node:test";

import { resolveQuietOpsRuntimeConfig } from "../src/index.js";

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
    }),
    {
      host: "0.0.0.0",
      port: 8080,
      decisionMode: "public-read-only",
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
    () => resolveQuietOpsRuntimeConfig({ QUIETOPS_HOST: "0.0.0.0" }),
    /requires QUIETOPS_DECISION_MODE=public-read-only/,
  );
});

test("rejects an unknown decision mode", () => {
  assert.throws(
    () =>
      resolveQuietOpsRuntimeConfig({
        QUIETOPS_DECISION_MODE: "public-interactive",
      }),
    /QUIETOPS_DECISION_MODE must be local-interactive or public-read-only/,
  );
});
