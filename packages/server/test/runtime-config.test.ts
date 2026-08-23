import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { resolveQuietOpsRuntimeConfig } from "../src/index.js";

const COMMIT = "924686c12afbcd437466fd56d0ea24be8df36696";
const REPOSITORY_ROOT = resolve("quietops-runtime-test-repository");
const PUBLIC_DATABASE_PATH = resolve(
  tmpdir(),
  "quietops-runtime-test-data",
  "quietops.sqlite",
);
const CONFIG_OPTIONS = Object.freeze({ repositoryRoot: REPOSITORY_ROOT });

function resolveConfig(environment: Record<string, string | undefined>) {
  return resolveQuietOpsRuntimeConfig(environment, CONFIG_OPTIONS);
}

test("defaults to the local interactive loopback runtime", () => {
  assert.deepEqual(resolveConfig({}), {
    host: "127.0.0.1",
    port: 4173,
    decisionMode: "local-interactive",
    databasePath: resolve(REPOSITORY_ROOT, ".quietops/quietops.sqlite"),
    githubWebhookEnabled: false,
  });
});

test("accepts a public read-only platform binding", () => {
  assert.deepEqual(
    resolveConfig({
      QUIETOPS_HOST: "0.0.0.0",
      PORT: "8080",
      QUIETOPS_DECISION_MODE: "public-read-only",
      QUIETOPS_RELEASE_COMMIT: COMMIT,
      QUIETOPS_DB_PATH: PUBLIC_DATABASE_PATH,
    }),
    {
      host: "0.0.0.0",
      port: 8080,
      decisionMode: "public-read-only",
      databasePath: PUBLIC_DATABASE_PATH,
      githubWebhookEnabled: false,
      releaseCommit: COMMIT,
    },
  );
});

test("keeps the local port alias and accepts matching dual configuration", () => {
  assert.equal(resolveConfig({ QUIETOPS_PORT: "4317" }).port, 4317);
  assert.equal(
    resolveConfig({ PORT: "4317", QUIETOPS_PORT: "04317" }).port,
    4317,
  );
});

test("rejects conflicting or invalid ports", () => {
  assert.throws(
    () => resolveConfig({ PORT: "8080", QUIETOPS_PORT: "4173" }),
    /must match/,
  );
  for (const value of ["", "0", "65536", "12.5", "-1", " 8080"]) {
    assert.throws(
      () => resolveConfig({ PORT: value }),
      /PORT must be an integer from 1 through 65535/,
    );
  }
});

test("rejects non-allowlisted hosts and an interactive public bind", () => {
  for (const host of ["localhost", "::", "example.com", "127.0.0.2"]) {
    assert.throws(
      () => resolveConfig({ QUIETOPS_HOST: host }),
      /QUIETOPS_HOST must be 127\.0\.0\.1 or 0\.0\.0\.0/,
    );
  }
  assert.throws(
    () =>
      resolveConfig({
        QUIETOPS_HOST: "0.0.0.0",
        QUIETOPS_RELEASE_COMMIT: COMMIT,
        QUIETOPS_DB_PATH: PUBLIC_DATABASE_PATH,
      }),
    /requires QUIETOPS_DECISION_MODE=public-read-only/,
  );
  assert.throws(
    () =>
      resolveConfig({
        QUIETOPS_HOST: "0.0.0.0",
        QUIETOPS_DECISION_MODE: "public-read-only",
        QUIETOPS_DB_PATH: PUBLIC_DATABASE_PATH,
      }),
    /requires a full QUIETOPS_RELEASE_COMMIT/,
  );
});

test("requires an explicit external database path for a public bind", () => {
  const publicEnvironment = {
    QUIETOPS_HOST: "0.0.0.0",
    QUIETOPS_DECISION_MODE: "public-read-only",
    QUIETOPS_RELEASE_COMMIT: COMMIT,
  };
  assert.throws(
    () => resolveConfig(publicEnvironment),
    /requires an absolute QUIETOPS_DB_PATH/,
  );
  assert.throws(
    () =>
      resolveConfig({
        ...publicEnvironment,
        QUIETOPS_DB_PATH: ".quietops/public.sqlite",
      }),
    /requires an absolute QUIETOPS_DB_PATH/,
  );
  assert.throws(
    () =>
      resolveConfig({
        ...publicEnvironment,
        QUIETOPS_DB_PATH: resolve(REPOSITORY_ROOT, "data/public.sqlite"),
      }),
    /must be outside the application repository/,
  );
});

test("resolves a local relative database path without weakening public rules", () => {
  assert.equal(
    resolveConfig({ QUIETOPS_DB_PATH: "local/custom.sqlite" }).databasePath,
    resolve(REPOSITORY_ROOT, "local/custom.sqlite"),
  );
  for (const databasePath of ["", "bad\0path"]) {
    assert.throws(
      () => resolveConfig({ QUIETOPS_DB_PATH: databasePath }),
      /QUIETOPS_DB_PATH must be a non-empty filesystem path/,
    );
  }
});

test("rejects an unknown decision mode or invalid release commit", () => {
  assert.throws(
    () =>
      resolveConfig({
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
        resolveConfig({
          QUIETOPS_RELEASE_COMMIT: releaseCommit,
        }),
      /QUIETOPS_RELEASE_COMMIT must be 40 lowercase hexadecimal characters/,
    );
  }
});

test("keeps GitHub webhook intake default-off and requires a bounded secret", () => {
  const secret = "quietops-runtime-webhook-secret-32-bytes-minimum";
  assert.deepEqual(
    resolveConfig({
      QUIETOPS_GITHUB_WEBHOOK_ENABLED: "true",
      QUIETOPS_GITHUB_WEBHOOK_SECRET: secret,
    }),
    {
      host: "127.0.0.1",
      port: 4173,
      decisionMode: "local-interactive",
      databasePath: resolve(REPOSITORY_ROOT, ".quietops/quietops.sqlite"),
      githubWebhookEnabled: true,
      githubWebhookSecret: secret,
    },
  );

  assert.equal(
    resolveConfig({ QUIETOPS_GITHUB_WEBHOOK_SECRET: secret })
      .githubWebhookEnabled,
    false,
  );
  for (const value of ["TRUE", "1", "yes", ""]) {
    assert.throws(
      () => resolveConfig({ QUIETOPS_GITHUB_WEBHOOK_ENABLED: value }),
      /must be true or false/,
    );
  }
  for (const secretValue of [undefined, "short", ` ${secret}`, `${secret}\n`]) {
    assert.throws(
      () =>
        resolveConfig({
          QUIETOPS_GITHUB_WEBHOOK_ENABLED: "true",
          QUIETOPS_GITHUB_WEBHOOK_SECRET: secretValue,
        }),
      /requires a 32-256 byte QUIETOPS_GITHUB_WEBHOOK_SECRET/,
    );
  }
});
